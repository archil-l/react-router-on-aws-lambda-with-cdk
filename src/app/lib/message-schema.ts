import z from "zod";

// ---- Tool part states ----

export type ToolPartState =
  | "input-streaming"
  | "input-available"
  | "output-available"
  | "output-error"
  | "approval-requested"
  | "approval-responded"
  | "output-denied";

// ---- Message part types ----

export type TextUIPart = { type: "text"; text: string };

export type ReasoningUIPart = {
  type: "reasoning";
  text: string;
  details?: unknown[];
};

export type DynamicToolUIPart = {
  type: "dynamic-tool";
  toolCallId: string;
  toolName: string;
  title?: string;
  state: ToolPartState;
  input: unknown;
  output?: unknown;
  errorText?: string;
  resourceUri?: string;
};

export type ToolUIPart = {
  type: `tool-${string}`;
  toolCallId: string;
  state: ToolPartState;
  input: unknown;
  output?: unknown;
  errorText?: string;
  title?: string;
};

export type FileUIPart = {
  type: "file";
  url?: string;
  mediaType?: string;
  filename?: string;
};

export type SourceUrlUIPart = {
  type: "source-url";
  url: string;
  title?: string;
};

export type SourceDocumentUIPart = {
  type: "source-document";
  title: string;
  filename?: string;
  mediaType?: string;
};

export type DataUIPart<T = unknown> = {
  type: `data-${string}`;
  data: T;
};

export type AgentUIMessagePart =
  | TextUIPart
  | ReasoningUIPart
  | DynamicToolUIPart
  | ToolUIPart
  | FileUIPart
  | SourceUrlUIPart
  | SourceDocumentUIPart
  | DataUIPart;

// ---- Metadata ----

export const metadataSchema = z.object({
  timestamp: z.iso.datetime().optional(),
  captchaToken: z.string().optional(),
});

export type AgentMetadata = z.infer<typeof metadataSchema>;

// ---- Message ----

export type AgentUIMessage = {
  id: string;
  role: "user" | "assistant";
  parts: AgentUIMessagePart[];
  metadata?: AgentMetadata;
};

// ---- AddToolOutputFn for client-side tool handlers ----

export type AddToolOutputFn = (args: {
  state: "output-available" | "output-error";
  tool: string;
  toolCallId: string;
  output: unknown;
}) => void;

// ---- Type guards ----

export function isTextUIPart(part: AgentUIMessagePart): part is TextUIPart {
  return part.type === "text";
}

export function isReasoningUIPart(
  part: AgentUIMessagePart,
): part is ReasoningUIPart {
  return part.type === "reasoning";
}

export function isToolUIPart(
  part: AgentUIMessagePart,
): part is DynamicToolUIPart | ToolUIPart {
  return (
    part.type === "dynamic-tool" ||
    (typeof part.type === "string" && part.type.startsWith("tool-"))
  );
}

export function isFileUIPart(part: AgentUIMessagePart): part is FileUIPart {
  return part.type === "file";
}

// ---- Shared UI types ----

export type ChatStatus =
  | "awaiting-message"
  | "submitted"
  | "streaming"
  | "error";

export type LanguageModelUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
};

// Used in agent.tsx component
export type Tool = {
  description?: string;
  inputSchema?: unknown;
  jsonSchema?: unknown;
};

// Stubs for experimental types used in generic UI components
export type Experimental_GeneratedImage = {
  base64: string;
  uint8Array?: Uint8Array;
  mediaType: string;
};

export type Experimental_SpeechResult = {
  audio: {
    base64: string;
    mediaType: string;
    uint8Array?: Uint8Array;
  };
  text?: string;
};

export type Experimental_TranscriptionResult = {
  text: string;
  segments: Array<{
    text: string;
    startSecond: number;
    endSecond: number;
  }>;
  language?: string;
  durationInSeconds?: number;
};
