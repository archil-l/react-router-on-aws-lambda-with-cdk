import z from "zod";

function tool<I extends z.ZodType>(def: {
  description: string;
  inputSchema: I;
  outputSchema?: z.ZodType;
}) {
  return def;
}

/**
 * toggleThemeTool - Toggle between light and dark theme
 *
 * This is a CLIENT-SIDE ONLY tool. NO execute function.
 * The actual theme toggle happens in ToggleThemeToolUI component on the client.
 */

export const themeSchema = z.enum(["light", "dark"]);

// Toggle Theme Tool
export const themeToggleOutput = z.object({
  toggled: z.boolean(),
  previousTheme: themeSchema,
  newTheme: themeSchema,
});

export type ThemeToggleOutputType = z.infer<typeof themeToggleOutput>;

export const toggleThemeTool = tool({
  description:
    "Toggle the website theme between light and dark mode. Call this when the user asks to change the theme, switch appearance, or toggle between modes.",
  inputSchema: z.object({}),
  outputSchema: themeToggleOutput,
});

// Check Theme Tool
export const themeCheckOutput = z.object({
  currentTheme: themeSchema,
});

export type ThemeCheckOutputType = z.infer<typeof themeCheckOutput>;

export const checkThemeTool = tool({
  description:
    "Check the current website theme (light or dark mode). Call this when the user asks what the current theme is, wants to know the appearance mode, or asks about the current color scheme.",
  inputSchema: z.object({}),
  outputSchema: themeCheckOutput,
});
