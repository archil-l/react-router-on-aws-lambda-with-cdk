"use client";

import type { TextUIPart } from "~/lib/message-schema";
import { MessageResponse } from "~/components/ai-elements/message";

interface TextPartProps {
  part: TextUIPart;
  messageId: string;
  index: number;
}

export function TextPart({ part, messageId, index }: TextPartProps) {
  return (
    <MessageResponse key={`${messageId}-text-${index}`}>
      {part.text}
    </MessageResponse>
  );
}
