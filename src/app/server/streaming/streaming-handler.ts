import Anthropic from "@anthropic-ai/sdk";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { verifyAuthHeader } from "../auth/jwt-verifier.js";
import { AgentUIMessage, DynamicToolUIPart } from "~/lib/message-schema";
import { buildSystemPrompt } from "~/lib/agent/system-prompt.js";
import { allTools } from "~/lib/agent/tools/index.js";
import { getMcpTools, type McpToolMeta } from "../mcp/mcp-client.js";
import z from "zod";

const MODEL = "claude-haiku-4-5-20251001";
const MAX_STEPS = 5;

// Client-side tools that must be executed on the browser
const CLIENT_SIDE_TOOLS = new Set(Object.keys(allTools));

const secretsClient = new SecretsManagerClient({
  region: process.env.AWS_REGION || "us-east-1",
});

const s3Client = new S3Client({
  region: process.env.AWS_REGION || "us-east-1",
});

async function saveConversationToS3(
  conversationId: string,
  messages: Anthropic.MessageParam[],
): Promise<void> {
  const bucketName = process.env.CONVERSATIONS_BUCKET_NAME;
  if (!bucketName) return;

  const now = new Date().toISOString();
  await s3Client.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: `conversations/${conversationId}.json`,
      Body: JSON.stringify({ conversationId, lastModified: now, messages }),
      ContentType: "application/json",
    }),
  );
}

async function fetchJWTSecret(): Promise<string> {
  try {
    const secretArn = process.env.JWT_SECRET_ARN;
    if (!secretArn) {
      throw new Error("JWT_SECRET_ARN environment variable is not set");
    }
    const command = new GetSecretValueCommand({ SecretId: secretArn });
    const response = await secretsClient.send(command);
    if (response.SecretString) {
      const secretJson = JSON.parse(response.SecretString);
      return secretJson.secret;
    }
    throw new Error("Secret does not have a SecretString");
  } catch (error) {
    console.error("Failed to fetch JWT secret:", error);
    throw error;
  }
}

// Lambda streaming types
interface StreamingEvent {
  body?: string;
  headers?: Record<string, string>;
  requestContext?: {
    http?: {
      method?: string;
    };
  };
}

interface ResponseStream extends NodeJS.WritableStream {
  setContentType(contentType: string): void;
}

interface HttpResponseStreamMetadata {
  statusCode: number;
  headers: Record<string, string>;
}

declare const awslambda: {
  streamifyResponse: (
    handler: (
      event: StreamingEvent,
      responseStream: ResponseStream,
      context: unknown,
    ) => Promise<void>,
  ) => (event: StreamingEvent, context: unknown) => Promise<void>;
  HttpResponseStream: {
    from: (
      responseStream: ResponseStream,
      metadata: HttpResponseStreamMetadata,
    ) => ResponseStream;
  };
};

// SSE event types
type SSEEvent =
  | { type: "text-delta"; delta: string }
  | { type: "reasoning-delta"; delta: string }
  | { type: "tool-meta"; toolMetaMap: Record<string, McpToolMeta> }
  | { type: "tool-start"; toolCallId: string; toolName: string }
  | { type: "tool-input-delta"; toolCallId: string; delta: string }
  | { type: "tool-input-done"; toolCallId: string; input: unknown }
  | { type: "tool-result"; toolCallId: string; output: unknown }
  | { type: "tool-error"; toolCallId: string; error: string }
  | {
      type: "client-tools-needed";
      tools: Array<{ toolCallId: string; toolName: string; input: unknown }>;
    }
  | { type: "done"; finishReason: string }
  | { type: "error"; error: string };

function writeSSE(stream: ResponseStream, event: SSEEvent): void {
  stream.write(`data: ${JSON.stringify(event)}\n\n`);
}

/**
 * Convert client-side Zod tool definitions to Anthropic Tool format
 */
function buildClientSideAnthropicTools(): Anthropic.Tool[] {
  return Object.entries(allTools).map(([name, def]) => ({
    name,
    description: def.description,
    input_schema: z.toJSONSchema(
      def.inputSchema,
    ) as Anthropic.Tool["input_schema"],
  }));
}

/**
 * Strips large binary/HTML fields from MCP tool output before sending to the LLM.
 * Removes structuredContent.pdfBase64 and any resource text/blob entries to avoid
 * blowing up the context window on subsequent turns.
 */
function stripLargeToolOutput(output: unknown): unknown {
  if (!output || typeof output !== "object") return output;
  const obj = output as Record<string, unknown>;
  const result: Record<string, unknown> = { ...obj };

  // Strip large fields from structuredContent
  if (
    result.structuredContent &&
    typeof result.structuredContent === "object"
  ) {
    const sc = { ...(result.structuredContent as Record<string, unknown>) };
    delete sc.pdfBase64;
    delete sc.filename;
    result.structuredContent = sc;
  }

  // Strip text/blob from resource content entries
  if (Array.isArray(result.content)) {
    result.content = result.content.map((item: unknown) => {
      if (!item || typeof item !== "object") return item;
      const entry = item as Record<string, unknown>;
      if (
        entry.type === "resource" &&
        entry.resource &&
        typeof entry.resource === "object"
      ) {
        const res = { ...(entry.resource as Record<string, unknown>) };
        delete res.text;
        delete res.blob;
        return { ...entry, resource: res };
      }
      return item;
    });
  }

  return result;
}

/**
 * Convert AgentUIMessage[] to Anthropic MessageParam[] format.
 * Tool results from a prior client-side round are passed separately and appended.
 *
 * For server-side MCP tools: the results are stored in DynamicToolUIPart.output
 * in the client's message history. We reconstruct the required tool_result user
 * message from those stored outputs so Anthropic doesn't complain about unmatched
 * tool_use blocks.
 *
 * For client-side tools: results come via the explicit toolResults parameter
 * (the client re-submits after executing them locally).
 *
 */
function convertToAnthropicMessages(
  messages: AgentUIMessage[],
  toolResults?: Array<{
    toolCallId: string;
    toolName: string;
    output: unknown;
  }>,
): Anthropic.MessageParam[] {
  const result: Anthropic.MessageParam[] = [];
  // Track tool call IDs already emitted from stored history to avoid duplicates
  // when toolResults is also provided on the immediate execution round.
  const emittedToolResultIds = new Set<string>();

  for (const msg of messages) {
    if (msg.role === "user") {
      const textContent = msg.parts
        .filter((p) => p.type === "text")
        .map((p) => (p as { type: "text"; text: string }).text)
        .join("\n");

      if (textContent.trim()) {
        result.push({ role: "user", content: textContent });
      }
    } else if (msg.role === "assistant") {
      const toolUseBlocks: Anthropic.ContentBlockParam[] = [];
      const textBlocks: Anthropic.ContentBlockParam[] = [];
      const storedToolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const part of msg.parts) {
        if (part.type === "text") {
          const text = (part as { type: "text"; text: string }).text;
          if (text) textBlocks.push({ type: "text", text });
        } else if (part.type === "dynamic-tool") {
          const toolPart = part as DynamicToolUIPart;
          toolUseBlocks.push({
            type: "tool_use",
            id: toolPart.toolCallId,
            name: toolPart.toolName,
            input: (toolPart.input as Record<string, unknown>) ?? {},
          });

          // Reconstruct tool_result from stored output for any tool (client-side or
          // server-side) that has already been executed. On the immediate execution
          // round the explicit toolResults parameter also carries these results, so
          // we track emitted IDs to avoid duplicates below.
          if (
            toolPart.state === "output-available" &&
            toolPart.output !== undefined
          ) {
            storedToolResults.push({
              type: "tool_result",
              tool_use_id: toolPart.toolCallId,
              content: JSON.stringify(stripLargeToolOutput(toolPart.output)),
            });
            emittedToolResultIds.add(toolPart.toolCallId);
          }
        }
      }

      // Emit tool_use blocks as their own assistant message so that the following
      // tool_result user message is never merged with subsequent user text.
      // Anthropic requires: assistant:[tool_use] → user:[tool_result] → assistant:[text]
      // If we put tool_use and text in the same assistant message, the tool_result
      // user message gets merged with the next user turn, violating Anthropic's rule
      // that a tool_result message must contain ONLY tool_result blocks.
      if (toolUseBlocks.length > 0) {
        result.push({ role: "assistant", content: toolUseBlocks });
        if (storedToolResults.length > 0) {
          result.push({ role: "user", content: storedToolResults });
        }
      }

      // Emit text blocks as a separate assistant message so they sit after the
      // tool_result user message, maintaining correct role alternation.
      if (textBlocks.length > 0) {
        result.push({ role: "assistant", content: textBlocks });
      }
    }
  }

  // Append tool results as a user message if provided (client-side tool execution
  // round). Skip any IDs already emitted from stored history to avoid duplicates.
  if (toolResults && toolResults.length > 0) {
    const deduped = toolResults.filter(
      (tr) => !emittedToolResultIds.has(tr.toolCallId),
    );
    if (deduped.length > 0) {
      result.push({
        role: "user",
        content: deduped.map((tr) => ({
          type: "tool_result" as const,
          tool_use_id: tr.toolCallId,
          content: JSON.stringify(tr.output),
        })),
      });
    }
  }

  // Merge consecutive messages of the same role. This can happen when a
  // tool_result user message is immediately followed by the next user text
  // message. Anthropic requires strictly alternating roles.
  const merged: Anthropic.MessageParam[] = [];
  for (const msg of result) {
    const prev = merged.at(-1);
    if (prev && prev.role === msg.role) {
      // Merge content arrays (or promote string content to text block)
      const prevContent: Anthropic.ContentBlockParam[] = Array.isArray(
        prev.content,
      )
        ? (prev.content as Anthropic.ContentBlockParam[])
        : [{ type: "text", text: prev.content as string }];
      const msgContent: Anthropic.ContentBlockParam[] = Array.isArray(
        msg.content,
      )
        ? (msg.content as Anthropic.ContentBlockParam[])
        : [{ type: "text", text: msg.content as string }];
      prev.content = [...prevContent, ...msgContent];
    } else {
      merged.push(msg);
    }
  }

  for (const [i, m] of merged.entries()) {
    const contentSummary = Array.isArray(m.content)
      ? (m.content as Anthropic.ContentBlockParam[]).map((b) => {
          if (b.type === "tool_use") {
            return { type: "tool_use", id: b.id, name: b.name };
          }
          if (b.type === "tool_result") {
            return {
              type: "tool_result",
              tool_use_id: (b as Anthropic.ToolResultBlockParam).tool_use_id,
            };
          }
          if (b.type === "text") {
            return { type: "text", len: b.text.length };
          }
          return { type: b.type };
        })
      : [{ type: "string", len: (m.content as string).length }];
  }

  return merged;
}

/**
 * Run the agentic loop: call Anthropic, execute MCP tools server-side,
 * and stream events to client. Stops when:
 * - Natural end (stop_reason: end_turn)
 * - Client-side tools needed (emits client-tools-needed event)
 * - Max steps reached
 */
async function runAgenticLoop(
  anthropic: Anthropic,
  messages: Anthropic.MessageParam[],
  tools: Anthropic.Tool[],
  mcpCallTool: (
    name: string,
    input: Record<string, unknown>,
  ) => Promise<unknown>,
  toolMetaMap: Record<string, McpToolMeta>,
  responseStream: ResponseStream,
  timezone?: string,
): Promise<Anthropic.MessageParam[]> {
  let currentMessages = [...messages];

  // Emit tool metadata first so the client knows which tools have UI resources
  writeSSE(responseStream, { type: "tool-meta", toolMetaMap });

  for (let step = 0; step < MAX_STEPS; step++) {
    for (const [i, m] of currentMessages.entries()) {
      const contentSummary = Array.isArray(m.content)
        ? (m.content as Anthropic.ContentBlockParam[]).map((b) => {
            if (b.type === "tool_use") {
              return { type: "tool_use", id: b.id, name: b.name };
            }
            if (b.type === "tool_result") {
              return {
                type: "tool_result",
                tool_use_id: (b as Anthropic.ToolResultBlockParam).tool_use_id,
              };
            }
            if (b.type === "text") {
              return { type: "text", len: b.text.length };
            }
            return { type: b.type };
          })
        : [{ type: "string", len: (m.content as string).length }];
    }

    // Track current tool call id for streaming input deltas
    let currentToolCallId: string | null = null;

    const stream = anthropic.messages.stream({
      model: MODEL,
      system: buildSystemPrompt(timezone),
      messages: currentMessages,
      tools: tools.length > 0 ? tools : undefined,
      max_tokens: 8192,
    });

    // Stream events to client as they arrive
    for await (const event of stream) {
      if (event.type === "content_block_start") {
        if (event.content_block.type === "tool_use") {
          currentToolCallId = event.content_block.id;
          writeSSE(responseStream, {
            type: "tool-start",
            toolCallId: event.content_block.id,
            toolName: event.content_block.name,
          });
        }
      } else if (event.type === "content_block_delta") {
        if (event.delta.type === "text_delta") {
          writeSSE(responseStream, {
            type: "text-delta",
            delta: event.delta.text,
          });
        } else if (
          event.delta.type === "input_json_delta" &&
          currentToolCallId
        ) {
          writeSSE(responseStream, {
            type: "tool-input-delta",
            toolCallId: currentToolCallId,
            delta: event.delta.partial_json,
          });
        }
      } else if (event.type === "content_block_stop") {
        currentToolCallId = null;
      }
    }

    const finalMessage = await stream.finalMessage();
    currentMessages.push({ role: "assistant", content: finalMessage.content });

    // If not a tool_use stop, we're done
    if (finalMessage.stop_reason !== "tool_use") {
      writeSSE(responseStream, {
        type: "done",
        finishReason: finalMessage.stop_reason ?? "end_turn",
      });
      return currentMessages;
    }

    // Collect tool use blocks
    const toolUseBlocks = finalMessage.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );

    const serverToolBlocks = toolUseBlocks.filter(
      (b) => !CLIENT_SIDE_TOOLS.has(b.name),
    );
    const clientToolBlocks = toolUseBlocks.filter((b) =>
      CLIENT_SIDE_TOOLS.has(b.name),
    );

    // Emit tool-input-done events for all tool use blocks
    for (const block of toolUseBlocks) {
      writeSSE(responseStream, {
        type: "tool-input-done",
        toolCallId: block.id,
        input: block.input,
      });
    }

    // Execute server-side (MCP) tools
    const toolResultContent: Anthropic.ToolResultBlockParam[] = [];

    for (const block of serverToolBlocks) {
      try {
        const output = await mcpCallTool(
          block.name,
          block.input as Record<string, unknown>,
        );
        writeSSE(responseStream, {
          type: "tool-result",
          toolCallId: block.id,
          output,
        });
        toolResultContent.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify(stripLargeToolOutput(output)),
          cache_control: { type: "ephemeral" },
        });
      } catch (err) {
        const errorMsg = String(err);
        writeSSE(responseStream, {
          type: "tool-error",
          toolCallId: block.id,
          error: errorMsg,
        });
        toolResultContent.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: `Error: ${errorMsg}`,
          is_error: true,
        });
      }
    }

    // If client-side tools are needed, pause and let client execute them
    if (clientToolBlocks.length > 0) {
      writeSSE(responseStream, {
        type: "client-tools-needed",
        tools: clientToolBlocks.map((b) => ({
          toolCallId: b.id,
          toolName: b.name,
          input: b.input,
        })),
      });
      writeSSE(responseStream, {
        type: "done",
        finishReason: "client-tools-needed",
      });
      return currentMessages;
    }

    // Continue with server tool results
    if (toolResultContent.length > 0) {
      currentMessages.push({ role: "user", content: toolResultContent });
    }
  }

  // Max steps reached
  writeSSE(responseStream, { type: "done", finishReason: "max-steps" });
  return currentMessages;
}

export const handler = awslambda.streamifyResponse(
  async (
    event: StreamingEvent,
    responseStream: ResponseStream,
    _context: unknown,
  ) => {
    // Handle CORS preflight
    if (event.requestContext?.http?.method === "OPTIONS") {
      responseStream = awslambda.HttpResponseStream.from(responseStream, {
        statusCode: 200,
        headers: {},
      });
      responseStream.end();
      return;
    }

    try {
      // Verify JWT token
      const jwtSecret = await fetchJWTSecret();
      const verificationResult = verifyAuthHeader(
        event.headers || {},
        jwtSecret,
      );

      if (!verificationResult) {
        responseStream = awslambda.HttpResponseStream.from(responseStream, {
          statusCode: 401,
          headers: { "Content-Type": "application/json" },
        });
        responseStream.write(
          JSON.stringify({ error: "Missing Authorization header" }),
        );
        responseStream.end();
        return;
      }

      if (!verificationResult.valid) {
        responseStream = awslambda.HttpResponseStream.from(responseStream, {
          statusCode: 401,
          headers: { "Content-Type": "application/json" },
        });
        responseStream.write(
          JSON.stringify({
            error: verificationResult.error || "Unauthorized",
          }),
        );
        responseStream.end();
        return;
      }

      // Parse request body
      const body = event.body ? JSON.parse(event.body) : {};
      const { messages: inputMessages, toolResults, timezone, conversationId } = body as {
        messages?: AgentUIMessage[];
        toolResults?: Array<{
          toolCallId: string;
          toolName: string;
          output: unknown;
        }>;
        timezone?: string;
        conversationId?: string;
      };

      if (!inputMessages || !Array.isArray(inputMessages)) {
        responseStream = awslambda.HttpResponseStream.from(responseStream, {
          statusCode: 400,
          headers: { "Content-Type": "application/json" },
        });
        responseStream.write(
          JSON.stringify({ error: "messages array is required" }),
        );
        responseStream.end();
        return;
      }

      if (!process.env.ANTHROPIC_API_KEY) {
        responseStream = awslambda.HttpResponseStream.from(responseStream, {
          statusCode: 500,
          headers: { "Content-Type": "application/json" },
        });
        responseStream.write(
          JSON.stringify({ error: "ANTHROPIC_API_KEY is not configured" }),
        );
        responseStream.end();
        return;
      }

      // Set up SSE streaming response
      responseStream = awslambda.HttpResponseStream.from(responseStream, {
        statusCode: 200,
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache",
        },
      });

      const anthropic = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
      });

      // Build Anthropic message history
      const anthropicMessages = convertToAnthropicMessages(
        inputMessages,
        toolResults,
      );

      // Load MCP tools (graceful degradation)
      const {
        anthropicTools: mcpTools,
        callTool,
        close,
        toolMetaMap,
      } = await getMcpTools();

      // Build combined tools list (client-side + MCP)
      const clientTools = buildClientSideAnthropicTools();
      const combinedTools = [...clientTools, ...mcpTools];

      console.log(
        "Available tools:",
        combinedTools.map((t) => t.name),
      );

      // Run the agentic loop
      const finalMessages = await runAgenticLoop(
        anthropic,
        anthropicMessages,
        combinedTools,
        callTool,
        Object.fromEntries(toolMetaMap),
        responseStream,
        timezone,
      );

      await close();
      responseStream.end();

      // Best-effort: save conversation history to S3 (do not await, never throws)
      if (conversationId) {
        saveConversationToS3(conversationId, finalMessages).catch((err) => {
          console.error("Failed to save conversation to S3:", err);
        });
      }
    } catch (error) {
      console.error("Streaming error:", error);
      const errorMessage =
        error instanceof Error ? error.message : "An unexpected error occurred";
      try {
        writeSSE(responseStream, { type: "error", error: errorMessage });
        responseStream.end();
      } catch {
        // Stream may already be closed
      }
    }
  },
);
