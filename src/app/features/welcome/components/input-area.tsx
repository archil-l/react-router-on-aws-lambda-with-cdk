import { useState, useEffect, useRef } from "react";
import { PromptInput } from "~/components/ai-elements/prompt-input";
import { PromptInputTextarea } from "~/components/ai-elements/prompt-input";
import { PromptInputSubmit } from "~/components/ai-elements/prompt-input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "~/components/ui/tooltip";
import { TurnstileWidget } from "~/components/ui/turnstile";
import type { TurnstileInstance } from "@marsidev/react-turnstile";
import { useConversationContext } from "~/contexts/conversation-context";

export function InputArea() {
  const { handleSubmit: onSubmit, isLoading } = useConversationContext();
  const [input, setInput] = useState("");
  const [captchaVerified, setCaptchaVerified] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const turnstileRef = useRef<TurnstileInstance>(null);

  const siteKey = import.meta.env.TURNSTILE_SITE_KEY || "";

  // Listen for suggestion clicks
  useEffect(() => {
    const handleSuggestionClick = (event: CustomEvent<string>) => {
      const suggestion = event.detail;
      onSubmit({ text: suggestion });
    };

    window.addEventListener(
      "suggestion-click",
      handleSuggestionClick as EventListener,
    );
    return () => {
      window.removeEventListener(
        "suggestion-click",
        handleSuggestionClick as EventListener,
      );
    };
  }, [onSubmit]);

  const handleVerifyCaptcha = (token: string) => {
    setCaptchaToken(token);
    setCaptchaVerified(true);
  };

  const handleSubmit = (message: { text?: string }) => {
    // Require CAPTCHA verification on first message
    if (!captchaVerified && siteKey) {
      alert("Please complete the CAPTCHA verification first");
      return;
    }

    onSubmit({ ...message, captchaToken: captchaToken || undefined });
    setInput("");
    // Don't reset CAPTCHA - it should only show once per session
  };

  return (
    <div className="w-full max-w-2xl mx-auto space-y-4">
      {/* Show CAPTCHA once until verified */}
      {!captchaVerified && siteKey && (
        <TurnstileWidget
          ref={turnstileRef}
          siteKey={siteKey}
          onVerify={handleVerifyCaptcha}
          onError={() => {
            console.error("Turnstile error");
            setCaptchaVerified(false);
          }}
          onExpire={() => {
            setCaptchaVerified(false);
            setCaptchaToken(null);
          }}
        />
      )}

      {/* Message input */}
      <PromptInput onSubmit={handleSubmit} className="w-full relative">
        <PromptInputTextarea
          value={input}
          placeholder="Ask anything"
          onChange={(e) => setInput(e.currentTarget.value)}
          className="pr-12 bg-background dark:bg-background transition duration-300"
          disabled={!captchaVerified && !!siteKey}
        />
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="absolute bottom-1 right-1">
                <PromptInputSubmit
                  disabled={
                    !input.trim() || isLoading || (!captchaVerified && !!siteKey)
                  }
                  status={isLoading ? "submitted" : undefined}
                />
              </span>
            </TooltipTrigger>
            <TooltipContent side="top">Send message</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </PromptInput>

      {!captchaVerified && siteKey && (
        <p className="text-sm text-muted-foreground text-center">
          Complete CAPTCHA verification to send your first message
        </p>
      )}
    </div>
  );
}
