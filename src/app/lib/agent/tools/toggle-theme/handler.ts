"use client";

import { Theme } from "~/hooks/use-theme";
import { AddToolOutputFn } from "~/lib/agent/hooks/use-client-tool-handlers";

/**
 * Creates a toggle theme handler for the AI chat tool system.
 * This handler executes the theme toggle and reports the result.
 */
export function createToggleThemeHandler(
  theme: Theme,
  toggleTheme: () => void,
) {
  return async (toolCallId: string, addToolOutput: AddToolOutputFn) => {
    const previousTheme = theme;
    const newTheme = previousTheme === "light" ? "dark" : "light";
    toggleTheme();

    addToolOutput({
      state: "output-available",
      tool: "toggleTheme",
      toolCallId,
      output: { toggled: true, previousTheme, newTheme },
    });

    console.log(`[toggleTheme] Tool execution completed`);
  };
}
