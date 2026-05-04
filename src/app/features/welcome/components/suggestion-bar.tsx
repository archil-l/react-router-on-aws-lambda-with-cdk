import { IconSuggestion } from "./icon-suggestion";
import { cn } from "~/lib/utils";
import type { SuggestionPrompt } from "../constants";

interface SuggestionBarProps {
  suggestions: SuggestionPrompt[];
  onSuggestionClick: (suggestion: string) => void;
  isVisible: boolean;
}

export function SuggestionBar({
  suggestions,
  onSuggestionClick,
  isVisible,
}: SuggestionBarProps) {
  return (
    <div
      className={cn(
        "pb-2 mt-2 w-full max-w-2xl mx-auto",
        isVisible
          ? "opacity-100 translate-y-0 pointer-events-auto"
          : "opacity-0 translate-y-4 pointer-events-none",
      )}
    >
      <div className="flex flex-wrap justify-center items-center gap-2">
        {suggestions.map((prompt) => (
          <IconSuggestion
            key={prompt.text}
            text={prompt.text}
            icon={prompt.icon}
            iconColor={prompt.iconColor}
            onClick={onSuggestionClick}
          />
        ))}
      </div>
    </div>
  );
}
