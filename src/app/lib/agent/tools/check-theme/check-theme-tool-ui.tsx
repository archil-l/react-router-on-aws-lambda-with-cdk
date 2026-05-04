"use client";

import type { DynamicToolUIPart } from "~/lib/message-schema";
import { Theme } from "~/hooks/use-theme";
import { motion } from "motion/react";
import { cn } from "~/lib/utils";
import { Moon, Sun, Eye } from "lucide-react";

export interface CheckThemeToolUIProps {
  tool: DynamicToolUIPart;
  theme: Theme;
  className?: string;
}

/**
 * CheckThemeToolUI - Dynamic UI component for the checkTheme tool
 *
 * Renders a visual indicator showing the current theme.
 * Unlike toggleTheme, this only displays the current state without changing it.
 */
export function CheckThemeToolUI({
  tool,
  theme,
  className,
}: CheckThemeToolUIProps) {
  const state = tool.state || "input-available";
  const isCompleted = state === "output-available" || state === "output-error";
  const isAnimating = !isCompleted;
  const isLight = theme === "light";

  return (
    <div className="flex py-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.8 }}
        transition={{ duration: 0.5 }}
        className={cn(
          "inline-flex items-center gap-3 rounded-lg bg-muted p-3 not-prose",
          className,
        )}
      >
        {/* Theme icon with animation */}
        <motion.div
          initial={{ rotate: -180, opacity: 0 }}
          animate={{ rotate: 0, opacity: 1 }}
          transition={{ delay: 0.2, duration: 0.5, ease: "easeOut" }}
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
          transition={{ delay: 0.3, duration: 0.3 }}
          className="text-sm font-medium"
        >
          Currently using{" "}
          <span className="font-semibold capitalize text-primary">{theme}</span>{" "}
          mode
        </motion.div>

        {/* Animated pulse effect while checking */}
        {isAnimating && (
          <motion.div
            className="absolute inset-0 rounded-lg border-2 border-primary/30"
            animate={{ scale: [1, 1.02, 1], opacity: [0.5, 0.8, 0.5] }}
            transition={{ duration: 1.5, repeat: Infinity }}
          />
        )}
      </motion.div>
    </div>
  );
}
