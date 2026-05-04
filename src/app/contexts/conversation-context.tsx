import { createContext, useContext, useEffect, useCallback } from "react";
import { saveConversationHistory, clearConversation } from "~/lib/session";
import { useToken } from "~/hooks/use-token";
import { INITIAL_WELCOME_MESSAGE } from "~/features/welcome/constants";
import { AgentUIMessage } from "~/lib/message-schema";
import { useAgentChat, useClientToolHandlers } from "~/lib/agent/hooks";

interface ConversationProviderProps {
  children: React.ReactNode;
  initialMessages?: AgentUIMessage[];
  isLoaded: boolean;
  streamingEndpoint: string;
  mcpProxyEndpoint: string | null;
  conversationId?: string;
}

interface ConversationContextType {
  messages: AgentUIMessage[];
  isLoading: boolean;
  error: Error | undefined;
  mcpProxyEndpoint: string | null;
  handleSubmit: (message: { text?: string; captchaToken?: string }) => void;
  handleClearConversation: () => void;
}

const ConversationContext = createContext<ConversationContextType | undefined>(
  undefined,
);

export function ConversationProvider({
  children,
  initialMessages = [],
  isLoaded,
  streamingEndpoint,
  mcpProxyEndpoint,
  conversationId,
}: ConversationProviderProps) {
  const { token, isTokenLoading } = useToken();

  // Don't render until token is available
  if (isTokenLoading || !token) {
    return null;
  }

  return (
    <ConversationProviderInner
      initialMessages={initialMessages}
      isLoaded={isLoaded}
      streamingEndpoint={streamingEndpoint}
      mcpProxyEndpoint={mcpProxyEndpoint}
      token={token}
      conversationId={conversationId}
    >
      {children}
    </ConversationProviderInner>
  );
}

interface ConversationProviderInnerProps {
  children: React.ReactNode;
  initialMessages: AgentUIMessage[];
  isLoaded: boolean;
  streamingEndpoint: string;
  mcpProxyEndpoint: string | null;
  token: string;
  conversationId?: string;
}

function ConversationProviderInner({
  children,
  initialMessages,
  isLoaded,
  streamingEndpoint,
  mcpProxyEndpoint,
  token,
  conversationId,
}: ConversationProviderInnerProps) {
  // Get client-side tool handlers
  const toolHandlers = useClientToolHandlers();

  const { messages, sendMessage, setMessages, error, status } = useAgentChat({
    initialMessages,
    streamingEndpoint,
    token,
    toolHandlers,
    conversationId,
  });

  // Save conversation to localStorage whenever messages change (after initial load)
  useEffect(() => {
    if (isLoaded && messages.length > 0) {
      saveConversationHistory(messages);
    }
  }, [messages, isLoaded]);

  const handleSubmit = useCallback(
    (message: { text?: string; captchaToken?: string }) => {
      if (!message.text?.trim()) return;
      sendMessage({
        text: message.text,
        metadata: { captchaToken: message.captchaToken },
      });
    },
    [sendMessage],
  );

  const handleClearConversation = useCallback(() => {
    clearConversation();
    setMessages([INITIAL_WELCOME_MESSAGE]);
  }, [setMessages]);

  return (
    <ConversationContext.Provider
      value={{
        messages,
        isLoading: status === "streaming" || status === "submitted",
        error,
        mcpProxyEndpoint,
        handleSubmit,
        handleClearConversation,
      }}
    >
      {children}
    </ConversationContext.Provider>
  );
}

export function useConversationContext() {
  const context = useContext(ConversationContext);

  if (context === undefined) {
    throw new Error(
      "useConversationContext must be used within a ConversationProvider",
    );
  }

  return context;
}
