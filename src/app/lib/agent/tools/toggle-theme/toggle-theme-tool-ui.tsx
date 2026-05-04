"use client";

import type { DynamicToolUIPart } from "~/lib/message-schema";
import { Theme } from "~/hooks/use-theme";
import { motion } from "motion/react";
import { cn } from "~/lib/utils";
import { Moon, Sun } from "lucide-react";

export interface ToggleThemeToolUIProps {
  tool: DynamicToolUIPart;
  theme: Theme;
  className?: string;
}

/**
 * ToggleThemeToolUI - Dynamic UI component for the toggleTheme tool
 *
 * Renders the ThemeSwitcher immediately when the tool is called.
 * The actual theme toggle is handled by useAgentChat's onToolCall handler.
 * This component just displays the animated feedback.
 */
export function ToggleThemeToolUI({
  tool,
  theme,
  className,
}: ToggleThemeToolUIProps) {
  // Get the state to determine if we're still running or completed
  const state = tool.state || "input-available";
  const isCompleted = state === "output-available" || state === "output-error";

  const isAnimating = !isCompleted;
  const isLight = theme === "light";
  // Always render the theme switcher - it shows the current theme state
  // The animation indicates the toggle is happening
  return (
    <div className="flex py-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.8 }}
        transition={{ duration: 1 }}
        className={cn(
          "inline-flex items-center gap-2 rounded-lg bg-muted p-3 not-prose",
          className,
        )}
      >
        <motion.div
          animate={{ rotate: isLight ? 180 : 0 }}
          transition={{ duration: 0.5, ease: "easeInOut" }}
          className="flex"
        >
          {isLight ? (
            <Sun className="size-5 text-yellow-500" />
          ) : (
            <Moon className="size-5 text-blue-400" />
          )}
        </motion.div>

        <motion.div
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.15, duration: 0.3 }}
          className="text-sm font-medium"
        >
          Switched to{" "}
          <span className="font-semibold capitalize text-primary">{theme}</span>{" "}
          mode
        </motion.div>

        {/* Animated background shimmer effect */}
        {isAnimating && (
          <motion.div
            className="absolute inset-0 rounded-lg bg-gradient-to-r from-transparent via-white to-transparent opacity-20"
            animate={{ x: ["100%", "-100%"] }}
            transition={{ duration: 1.5, repeat: Infinity }}
          />
        )}
      </motion.div>
    </div>
  );
}
