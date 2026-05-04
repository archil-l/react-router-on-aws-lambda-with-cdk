"use client";

import type { SourceUrlUIPart, SourceDocumentUIPart, DataUIPart } from "~/lib/message-schema";

interface SourceUrlPartProps {
  part: SourceUrlUIPart;
  messageId: string;
  index: number;
}

export function SourceUrlPart({ part, messageId, index }: SourceUrlPartProps) {
  return (
    <div
      key={`${messageId}-source-url-${index}`}
      className="rounded-lg border border-muted bg-muted/50 p-3"
    >
      <a
        href={part.url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm text-blue-600 hover:underline dark:text-blue-400"
      >
        {part.title || part.url}
      </a>
    </div>
  );
}

interface SourceDocumentPartProps {
  part: SourceDocumentUIPart;
  messageId: string;
  index: number;
}

export function SourceDocumentPart({
  part,
  messageId,
  index,
}: SourceDocumentPartProps) {
  return (
    <div
      key={`${messageId}-source-doc-${index}`}
      className="rounded-lg border border-muted bg-muted/50 p-3"
    >
      <div className="text-sm">
        <div className="font-medium">{part.title}</div>
        {part.filename && (
          <div className="text-xs text-muted-foreground">{part.filename}</div>
        )}
      </div>
    </div>
  );
}

interface DataPartProps {
  part: DataUIPart;
  messageId: string;
  index: number;
}

export function DataPart({ part, messageId, index }: DataPartProps) {
  return (
    <div
      key={`${messageId}-data-${index}`}
      className="rounded-lg border border-muted bg-muted/50 p-4"
    >
      <pre className="overflow-x-auto text-xs">
        {JSON.stringify(part.data, null, 2)}
      </pre>
    </div>
  );
}
