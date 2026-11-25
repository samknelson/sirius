import type { ContractChatAnswer, ContractChatCatalogEntry } from "./types";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  answer?: ContractChatAnswer;
}

export interface ChatContext {
  /** Opaque scope bound to effective user, login session and provider revision. */
  context: string;
  providerName: string;
  external: boolean;
  contracts: ContractChatCatalogEntry[];
}

/** Keep complete answered turns; failed/empty replies never become context. */
export function providerWindow(history: ChatMessage[], question: string) {
  const turns: { role: "user" | "assistant"; content: string }[][] = [];
  for (let i = 0; i < history.length - 1; i++) {
    const user = history[i], assistant = history[i + 1];
    if (user.role === "user" && assistant.role === "assistant" &&
        user.content.trim() && user.content.length <= 4000 &&
        assistant.content.trim() && assistant.content.length <= 20000) {
      turns.push([{ role: "user", content: user.content }, { role: "assistant", content: assistant.content }]);
      i++;
    }
  }
  return [...turns.slice(-9).flat(), { role: "user" as const, content: question }];
}
