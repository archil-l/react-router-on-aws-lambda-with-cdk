"use client";

import type { AgentUIMessagePart } from "~/lib/message-schema";
import {
  isTextUIPart,
  isReasoningUIPart,
  isToolUIPart,
  isFileUIPart,
} from "~/lib/message-schema";
import { TextPart } from "./text-part";
import { ReasoningPart } from "./reasoning-part";
import { ToolPart } from "./tool-part";
import { FilePart } from "./file-part";
import {
  SourceUrlPart,
  SourceDocumentPart,
  DataPart,
} from "./source-and-data-part";

interface UIMessagePartRendererProps {
  part: AgentUIMessagePart;
  index: number;
  messageId: string;
  isStreaming: boolean;
}

export function UIMessagePartRenderer({
  part,
  index,
  messageId,
  isStreaming,
}: UIMessagePartRendererProps) {
  if (isTextUIPart(part)) {
    return <TextPart part={part} messageId={messageId} index={index} />;
  }

  if (isReasoningUIPart(part)) {
    return (
      <ReasoningPart
        part={part}
        messageId={messageId}
        index={index}
        isStreaming={isStreaming}
      />
    );
  }

  if (isToolUIPart(part)) {
    return <ToolPart part={part} messageId={messageId} index={index} />;
  }

  if (isFileUIPart(part)) {
    return <FilePart part={part} messageId={messageId} index={index} />;
  }

  if ("type" in part && part.type === "source-url") {
    return (
      <SourceUrlPart part={part as any} messageId={messageId} index={index} />
    );
  }

  if ("type" in part && part.type === "source-document") {
    return (
      <SourceDocumentPart
        part={part as any}
        messageId={messageId}
        index={index}
      />
    );
  }

  if ("type" in part && part.type.startsWith("data-")) {
    return <DataPart part={part as any} messageId={messageId} index={index} />;
  }

  return null;
}
