import { AddToolOutputFn } from "~/lib/message-schema";
import { useThemeContext } from "~/contexts/theme-context";
import { createToggleThemeHandler } from "~/lib/agent/tools/toggle-theme";
import { createCheckThemeHandler } from "~/lib/agent/tools/check-theme";
export type { AddToolOutputFn };

/**
 * Generic tool handler type for client-side tools.
 * Each handler receives the toolCallId and addToolOutput function.
 */
export type ClientToolHandler = (
  toolCallId: string,
  addToolOutput: AddToolOutputFn,
) => Promise<void>;

export type ClientToolHandlers = Record<string, ClientToolHandler>;

/**
 * Hook that aggregates all client-side tool handlers.
 * Add new tool handlers here to make them available to useAgentChat.
 */
export function useClientToolHandlers(): ClientToolHandlers {
  const { theme, toggleTheme } = useThemeContext();

  return {
    toggleTheme: createToggleThemeHandler(theme, toggleTheme),
    checkTheme: createCheckThemeHandler(theme),
    // Add more client-side tool handlers here as needed:
    // copyToClipboard: createCopyToClipboardHandler(...),
    // playSound: createPlaySoundHandler(...),
  };
}
