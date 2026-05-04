import { ArrowDown } from "lucide-react";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

interface ScrollToBottomButtonProps {
  onClick: () => void;
  show: boolean;
  className?: string;
}

export function ScrollToBottomButton({
  onClick,
  show,
  className,
}: ScrollToBottomButtonProps) {
  if (!show) return null;

  return (
    <div
      className={cn(
        "fixed left-1/2 -translate-x-1/2 z-600 transition-opacity duration-200",
        show ? "opacity-100" : "opacity-0 pointer-events-none",
        className,
      )}
    >
      <Button
        onClick={onClick}
        size="icon"
        variant="outline"
        className="rounded-full shadow-lg bg-background hover:bg-accent opacity-50 hover:opacity-100"
      >
        <ArrowDown className="h-4 w-4" />
      </Button>
    </div>
  );
}
