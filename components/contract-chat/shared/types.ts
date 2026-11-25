/**
 * Provider-neutral contract-chat vocabulary. Provider IDs are opaque and are
 * NOT Sirius contract IDs; externalRef is an optional, explicit host mapping.
 * Callers own authorization, trusted role/identity, and conversation history.
 */
export interface ContractChatArgs {
  contractId: string;
  role: "staff" | "steward" | "member";
  messages: { role: "user" | "assistant"; content: string }[];
  userRef?: string;
  sessionRef?: string;
  mode?: "whole" | "pages";
}

export type ContractChatStatus = "ok" | "truncated" | "refusal" | "timeout" | "error" | "client_closed";
export type ContractStatus = "current" | "expired" | "side_document";

export interface ContractChatCitation {
  document: string;
  page: number;
  endPage: number;
  article: string | null;
  section: string | null;
  quote: string;
}

export interface ContractChatAnswer {
  requestId: string;
  contractId: string;
  contractName: string;
  contractStatus: ContractStatus;
  externalRef: string | null;
  notice: string | null;
  answer: string;
  citations: ContractChatCitation[];
  status: ContractChatStatus;
  error: { code: string; message: string } | null;
  likelyGrievance: boolean | null;
  scope: "in_contract" | "not_in_contract" | "off_purpose" | null;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens: number;
    cacheCreationInputTokens: number;
  };
  costUsd?: number;
  latencyMs?: number;
  timeToFirstTokenMs?: number | null;
  model?: string;
  stopReason?: string | null;
}

export interface ContractChatCatalogEntry {
  id: string;
  name: string;
  status: ContractStatus;
  notice: string | null;
  externalRef: string | null;
  termEnd: string | null;
  version: number;
  documents: { id: string; name: string }[];
}

export interface ContractChatSearchArgs {
  query: string;
  contractIds?: string[];
  limit?: number;
}

export interface ContractChatSearchHit {
  contractId: string;
  contractName: string;
  contractStatus: ContractStatus;
  notice: string | null;
  document: string;
  documentId: string;
  page: number;
  article: string | null;
  section: string | null;
  snippet: string;
}

export type ContractChatRoute =
  | { kind: "contract"; contractId: string }
  | { kind: "ask" | "none" };

export interface ContractChatFeedbackArgs {
  requestId: string;
  rating: "up" | "down";
  comment?: string;
}

// Type-only extension: this package does not install another registry/kind.
declare module "../../../server/plugins/wc-vendors/types" {
  interface WcVendorOperations {
    "contract.chat.catalog": { args: void; result: ContractChatCatalogEntry[] };
    "contract.chat.ask": { args: ContractChatArgs; result: ContractChatAnswer };
    "contract.chat.search": { args: ContractChatSearchArgs; result: ContractChatSearchHit[] };
    "contract.chat.route": { args: { question: string }; result: ContractChatRoute };
    "contract.chat.feedback": {
      args: ContractChatFeedbackArgs;
      result: { ok: true; persisted: boolean };
    };
  }
}
