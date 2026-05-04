"use client";

import type { FileUIPart } from "~/lib/message-schema";

interface FilePartProps {
  part: FileUIPart;
  messageId: string;
  index: number;
}

export function FilePart({ part, messageId, index }: FilePartProps) {
  const mediaType = part.mediaType || "";
  const isImage = mediaType.startsWith("image/");

  if (isImage && part.url) {
    return (
      <img
        key={`${messageId}-file-${index}`}
        alt={part.filename || "attachment"}
        src={part.url}
        className="max-w-full rounded-lg"
      />
    );
  }

  return (
    <div
      key={`${messageId}-file-${index}`}
      className="rounded-lg border border-muted bg-muted/50 p-4"
    >
      <div className="text-sm">
        <div className="font-medium">{part.filename || "File"}</div>
        <div className="text-xs text-muted-foreground">{mediaType}</div>
      </div>
    </div>
  );
}
