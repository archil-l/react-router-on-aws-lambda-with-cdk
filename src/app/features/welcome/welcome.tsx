"use client";

import { PREDEFINED_PROMPTS } from "./constants";
import { useWelcomeSession } from "./hooks/use-welcome-session";
import { ConversationProvider } from "~/contexts/conversation-context";
import { WelcomeLoader } from "./components/welcome-loader";
import { ConversationArea } from "./components/conversation-area";
import { InputArea } from "./components/input-area";
import { SuggestionBar } from "./components/suggestion-bar";
import { ScrollToBottomButton } from "./components/scroll-to-bottom-button";
import { useAutoScroll } from "./hooks/use-auto-scroll";
import { useConversationContext } from "~/contexts/conversation-context";
import { WelcomeHeader } from "./components/welcome-header";

interface WelcomeProps {
  streamingEndpoint: string;
  mcpProxyEndpoint: string | null;
}

export default function Welcome({ streamingEndpoint, mcpProxyEndpoint }: WelcomeProps) {
  const { messages: initialMessages, isLoaded, sessionId } = useWelcomeSession();

  // Show loading state until client-side hydration is complete
  if (!isLoaded) {
    return <WelcomeLoader />;
  }

  return (
    <ConversationProvider
      initialMessages={initialMessages}
      isLoaded={isLoaded}
      streamingEndpoint={streamingEndpoint}
      mcpProxyEndpoint={mcpProxyEndpoint}
      conversationId={sessionId}
    >
      <WelcomeContent />
    </ConversationProvider>
  );
}

function WelcomeContent() {
  const { messages, isLoading } = useConversationContext();
  const { showScrollButton, scrollToBottom } = useAutoScroll({
    messages,
    isLoading,
  });

  // Hide suggestions after the first user message (messages.length > 1)
  const showSuggestions = messages.length <= 1;

  return (
    <div className="relative h-full w-full">
      {/* Header with icon buttons */}
      <WelcomeHeader />

      {/* Main Content */}
      <ConversationArea className="mt-[100px] w-full max-w-3xl mx-auto relative" />

      <div className="fixed w-full left-[50%] translate-x-[-50%] bottom-[100px] p-4 z-50 justify-items-center pointer-events-none">
        <SuggestionBar
          suggestions={PREDEFINED_PROMPTS}
          onSuggestionClick={(suggestion) => {
            // InputArea will handle this via context
            const event = new CustomEvent("suggestion-click", {
              detail: suggestion,
            });
            window.dispatchEvent(event);
          }}
          isVisible={showSuggestions}
        />
      </div>

      {/* Scroll to Bottom Button */}
      <ScrollToBottomButton
        onClick={scrollToBottom}
        show={showScrollButton}
        className="bottom-[170px]"
      />

      {/* Input and Suggestions */}
      <div className="fixed w-full bottom-0 p-4 z-50 justify-items-center">
        <InputArea />
      </div>
    </div>
  );
}
