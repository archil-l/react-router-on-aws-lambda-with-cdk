import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { getToolUiResourceUri } from "@modelcontextprotocol/ext-apps/app-bridge";
import { createSignedFetcher } from "aws-sigv4-fetch";
import { STSClient, AssumeRoleCommand } from "@aws-sdk/client-sts";
import type Anthropic from "@anthropic-ai/sdk";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

// MCP Server configuration
const MCP_SERVER_URL = process.env.MCP_SERVER_URL;
const AWS_REGION = process.env.AWS_REGION;
const CLIENT_ACCESS_ROLE_ARN = process.env.CLIENT_ACCESS_ROLE_ARN;

/**
 * Gets temporary credentials by assuming the client access role
 */
async function getCredentials() {
  const stsClient = new STSClient({ region: AWS_REGION });

  try {
    const assumeRoleCommand = new AssumeRoleCommand({
      RoleArn: CLIENT_ACCESS_ROLE_ARN,
      RoleSessionName: "mcp-client-session",
      DurationSeconds: 900, // 15 minutes
    });

    const response = await stsClient.send(assumeRoleCommand);

    if (!response.Credentials) {
      throw new Error("Failed to get temporary credentials from STS");
    }

    return {
      accessKeyId: response.Credentials.AccessKeyId!,
      secretAccessKey: response.Credentials.SecretAccessKey!,
      sessionToken: response.Credentials.SessionToken,
    };
  } catch (error) {
    console.error("Failed to assume client access role:", error);
    throw error;
  }
}

export interface ServerInfo {
  name: string;
  client: Client;
  tools: Map<string, Tool>;
}

export type McpToolMeta = { resourceUri: string; title?: string };

export type McpToolsClient = {
  anthropicTools: Anthropic.Tool[];
  serverInfo: ServerInfo | null;
  toolMetaMap: Map<string, McpToolMeta>;
  callTool: (name: string, input: Record<string, unknown>) => Promise<unknown>;
  close: () => Promise<void>;
};

/**
 * Creates and connects an MCP client, returning Anthropic-compatible tools
 * and a callTool function for server-side tool execution.
 * Returns empty tools with graceful degradation if connection fails.
 */
export async function getMcpTools(): Promise<McpToolsClient> {
  if (!MCP_SERVER_URL) {
    console.log("MCP_SERVER_URL not set, skipping MCP tools");
    return {
      anthropicTools: [],
      serverInfo: null,
      toolMetaMap: new Map(),
      callTool: async () => ({}),
      close: async () => {},
    };
  }

  try {
    const { accessKeyId, secretAccessKey, sessionToken } =
      await getCredentials();

    const signedFetch = createSignedFetcher({
      service: "lambda",
      region: AWS_REGION,
      credentials: {
        accessKeyId,
        secretAccessKey,
        sessionToken,
      },
    });

    const serverUrl = new URL(MCP_SERVER_URL);

    // Try Streamable HTTP first, fall back to SSE
    let client: Client;
    try {
      client = new Client({
        name: "mcp-client",
        version: "1.0.0",
      });
      await client.connect(
        new StreamableHTTPClientTransport(serverUrl, { fetch: signedFetch }),
      );
      console.log("Connected via Streamable HTTP transport");
    } catch (streamableError) {
      console.log(
        "Streamable HTTP failed, falling back to SSE:",
        streamableError,
      );
      client = new Client({
        name: "mcp-client",
        version: "1.0.0",
      });
      await client.connect(
        new SSEClientTransport(serverUrl, { fetch: signedFetch }),
      );
      console.log("Connected via SSE transport");
    }

    // Get tools list
    const { tools } = await client.listTools();
    console.log(
      "MCP tools loaded:",
      tools.map((t) => t.name),
    );

    // Build maps
    const toolsMap = new Map(tools.map((tool) => [tool.name, tool]));

    // Convert to Anthropic format
    const anthropicTools: Anthropic.Tool[] = tools.map((t) => ({
      name: t.name,
      description: t.description ?? "",
      input_schema: (t.inputSchema as Anthropic.Tool["input_schema"]) ?? {
        type: "object",
        properties: {},
      },
    }));

    // Build tool → UI resource URI map using the official helper.
    // This is sent to the client so it can fetch resources directly from the MCP proxy.
    const toolMetaMap = new Map<string, McpToolMeta>();
    for (const t of tools) {
      const uiResourceUri = getToolUiResourceUri(t);
      if (uiResourceUri) {
        toolMetaMap.set(t.name, {
          resourceUri: uiResourceUri,
          title: t.title,
        });
      }
    }

    console.log("MCP tools with UI resources:", [...toolMetaMap.keys()]);

    // Prepare server info object
    const serverInfo: ServerInfo = {
      name: client.getServerVersion()?.name ?? MCP_SERVER_URL,
      client,
      tools: toolsMap,
    };

    return {
      anthropicTools,
      serverInfo,
      toolMetaMap,
      callTool: async (name: string, input: Record<string, unknown>) => {
        const result = await client.callTool({ name, arguments: input });
        return result;
      },
      close: () => client.close(),
    };
  } catch (error) {
    console.error("Failed to connect to MCP server:", error);
    return {
      anthropicTools: [],
      serverInfo: null,
      toolMetaMap: new Map(),
      callTool: async () => ({}),
      close: async () => {},
    };
  }
}
