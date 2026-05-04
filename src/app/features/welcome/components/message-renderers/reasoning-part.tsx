"use client";

import type { ReasoningUIPart } from "~/lib/message-schema";
import {
  Reasoning,
  ReasoningTrigger,
  ReasoningContent,
} from "~/components/ai-elements/reasoning";

interface ReasoningPartProps {
  part: ReasoningUIPart;
  messageId: string;
  index: number;
  isStreaming: boolean;
}

export function ReasoningPart({
  part,
  messageId,
  index,
  isStreaming,
}: ReasoningPartProps) {
  return (
    <Reasoning
      key={`${messageId}-reasoning-${index}`}
      isStreaming={isStreaming}
      defaultOpen={true}
    >
      <ReasoningTrigger />
      <ReasoningContent>{part.text}</ReasoningContent>
    </Reasoning>
  );
}
