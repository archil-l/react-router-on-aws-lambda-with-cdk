export const WELCOME_MESSAGE = `# Welcome! 👋

I'm an AI assistant. Ask me anything!
`;

import {
  MessageCircle,
  type LucideIcon,
} from "lucide-react";
import { AgentUIMessage } from "~/lib/message-schema";

export interface SuggestionPrompt {
  text: string;
  icon: LucideIcon;
  iconColor: string;
}

export const PREDEFINED_PROMPTS: SuggestionPrompt[] = [
  {
    text: "What can you help me with?",
    icon: MessageCircle,
    iconColor: "text-blue-500",
  },
];

export const INITIAL_WELCOME_MESSAGE: AgentUIMessage = {
  id: "welcome",
  role: "assistant",
  parts: [{ type: "text", text: WELCOME_MESSAGE }],
};
