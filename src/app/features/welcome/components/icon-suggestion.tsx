import { Suggestion } from "~/components/ai-elements/suggestion";
import { cn } from "~/lib/utils";
import type { LucideIcon } from "lucide-react";

interface IconSuggestionProps {
  text: string;
  icon: LucideIcon;
  iconColor: string;
  onClick: (text: string) => void;
}

export function IconSuggestion({
  text,
  icon: Icon,
  iconColor,
  onClick,
}: IconSuggestionProps) {
  return (
    <Suggestion
      suggestion={text}
      onClick={onClick}
      className="font-normal bg-background dark:bg-background hover:bg-background dark:hover:bg-background"
    >
      <div className="flex items-center gap-2">
        <Icon className={cn("h-4 w-4", iconColor)} />
        <span>{text}</span>
      </div>
    </Suggestion>
  );
}
