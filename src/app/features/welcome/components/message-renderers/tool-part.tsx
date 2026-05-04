"use client";

import type { DynamicToolUIPart, ToolUIPart } from "~/lib/message-schema";
import {
  Tool,
  ToolHeader,
  ToolContent,
  ToolInput,
  ToolOutput,
} from "~/components/ai-elements/tool";
import { ToggleThemeToolUI } from "~/lib/agent/tools/toggle-theme/toggle-theme-tool-ui";
import { CheckThemeToolUI } from "~/lib/agent/tools/check-theme/check-theme-tool-ui";
import {
  ThemeToggleOutputType,
  ThemeCheckOutputType,
} from "~/lib/agent/tools/client-side-tools";
import { WebPreviewToolUI } from "~/lib/agent/tools/web-preview";
import { McpToolUI } from "~/lib/agent/tools/mcp-ui/mcp-tool-ui";
import { useConversationContext } from "~/contexts/conversation-context";

interface ToolPartProps {
  part: DynamicToolUIPart | ToolUIPart;
  messageId: string;
  index: number;
}

export function ToolPart({ part, messageId, index }: ToolPartProps) {
  const { mcpProxyEndpoint } = useConversationContext();

  const isDynamic = part.type === "dynamic-tool";
  const dynPart = isDynamic ? (part as DynamicToolUIPart) : null;
  const staticPart = !isDynamic ? (part as ToolUIPart) : null;
  const state = part.state || "input-available";
  const toolIsStreaming = state === "input-streaming";
  const hasOutput = state === "output-available" || state === "output-error";

  const toolName = isDynamic ? dynPart!.toolName : staticPart!.type.slice(5);

  if (toolName === "toggleTheme" && dynPart) {
    return (
      <ToggleThemeToolUI
        key={`${messageId}-tool-${index}`}
        tool={dynPart}
        theme={(dynPart.output as ThemeToggleOutputType)?.newTheme}
      />
    );
  }

  if (toolName === "checkTheme" && dynPart) {
    return (
      <CheckThemeToolUI
        key={`${messageId}-tool-${index}`}
        tool={dynPart}
        theme={(dynPart.output as ThemeCheckOutputType)?.currentTheme}
      />
    );
  }

  if (toolName === "webpreview" && dynPart) {
    const url =
      dynPart.input &&
      typeof dynPart.input === "object" &&
      "url" in dynPart.input
        ? (dynPart.input as any).url
        : "";
    return (
      <WebPreviewToolUI
        key={`${messageId}-tool-${index}`}
        tool={dynPart}
        url={url}
      />
    );
  }

  if (dynPart && dynPart.resourceUri && mcpProxyEndpoint) {
    return (
      <McpToolUI
        key={`${messageId}-tool-${index}`}
        tool={dynPart}
        mcpProxyEndpoint={mcpProxyEndpoint}
      />
    );
  }

  // Generic tool rendering
  const toolHeaderProps = isDynamic
    ? {
        title: dynPart!.title || dynPart!.toolName,
        type: "dynamic-tool" as const,
        state,
        toolName: dynPart!.toolName,
      }
    : {
        title: staticPart!.title || staticPart!.type.slice(5),
        type: staticPart!.type,
        state,
      };

  return (
    <Tool key={`${messageId}-tool-${index}`}>
      <ToolHeader {...(toolHeaderProps as any)} />
      <ToolContent>
        {(part.input !== undefined || toolIsStreaming) && (
          <ToolInput input={part.input} />
        )}
        {hasOutput && (
          <ToolOutput output={part.output} errorText={part.errorText || ""} />
        )}
      </ToolContent>
    </Tool>
  );
}
