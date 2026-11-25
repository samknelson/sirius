import type { ChatMessage } from "../../shared/experience";
import type { ContractChatAnswer } from "../../shared/types";

const VERSION = 1;
const PREFIX = "sirius:contract-chat:v1:";
const clearListeners = new Set<() => void>();
const pageMemory = new Map<string, DisplayMessage[]>();
const storageFailures = new Set<string>();

export function historyStorageFailed(key: string): boolean {
  return storageFailures.has(key);
}

export interface DisplayMessage {
  role: "user" | "assistant";
  content: string;
  answer?: ContractChatAnswer;
  outcome?: string;
}

export function effectiveIdentity(userId: string, isMasquerading: boolean, originalUserId?: string): string {
  return isMasquerading
    ? `${userId}:masquerading:${originalUserId ?? "unknown"}`
    : userId;
}

interface StoredHistory {
  version: 1;
  messages: DisplayMessage[];
}

function keyPart(value: string): string {
  return encodeURIComponent(value);
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function historyKey(identity: string, context: string, contractId: string): string {
  return `${PREFIX}${keyPart(identity)}:${keyPart(context)}:${keyPart(contractId)}`;
}

export function isValidAnswer(value: unknown): value is ContractChatAnswer {
  if (!value || typeof value !== "object") return false;
  const answer = value as ContractChatAnswer;
  const validError = answer.error === null || (
    !!answer.error &&
    typeof answer.error === "object" &&
    typeof answer.error.code === "string" &&
    typeof answer.error.message === "string"
  );
  const validUsage = answer.usage === undefined || (
    !!answer.usage &&
    typeof answer.usage === "object" &&
    finiteNumber(answer.usage.inputTokens) &&
    finiteNumber(answer.usage.outputTokens) &&
    finiteNumber(answer.usage.cacheReadInputTokens) &&
    finiteNumber(answer.usage.cacheCreationInputTokens)
  );
  const validCitations = Array.isArray(answer.citations) && answer.citations.every((citation) =>
    !!citation &&
    typeof citation === "object" &&
    typeof citation.document === "string" &&
    finiteNumber(citation.page) &&
    finiteNumber(citation.endPage) &&
    nullableString(citation.article) &&
    nullableString(citation.section) &&
    typeof citation.quote === "string");
  return typeof answer.requestId === "string" &&
    typeof answer.contractId === "string" &&
    typeof answer.contractName === "string" &&
    ["current", "expired", "side_document"].includes(answer.contractStatus) &&
    nullableString(answer.externalRef) &&
    nullableString(answer.notice) &&
    typeof answer.answer === "string" && answer.answer.length <= 2_000_000 &&
    validCitations &&
    ["ok", "truncated", "refusal", "timeout", "error", "client_closed"].includes(answer.status) &&
    validError &&
    (answer.likelyGrievance === null || typeof answer.likelyGrievance === "boolean") &&
    (answer.scope === null || ["in_contract", "not_in_contract", "off_purpose"].includes(answer.scope)) &&
    validUsage &&
    (answer.costUsd === undefined || finiteNumber(answer.costUsd)) &&
    (answer.latencyMs === undefined || finiteNumber(answer.latencyMs)) &&
    (answer.timeToFirstTokenMs === undefined || answer.timeToFirstTokenMs === null || finiteNumber(answer.timeToFirstTokenMs)) &&
    (answer.model === undefined || typeof answer.model === "string") &&
    (answer.stopReason === undefined || answer.stopReason === null || typeof answer.stopReason === "string");
}

export function validateMessages(value: unknown): value is DisplayMessage[] {
  return Array.isArray(value) && value.every((item) => {
    if (!item || typeof item !== "object") return false;
    const message = item as DisplayMessage;
    return (message.role === "user" || message.role === "assistant") &&
      typeof message.content === "string" &&
      (message.role === "user" ? message.content.length <= 4000 : message.content.length <= 2_000_000) &&
      (message.answer === undefined || (message.role === "assistant" && isValidAnswer(message.answer))) &&
      (message.outcome === undefined || typeof message.outcome === "string");
  });
}

export function readHistory(key: string): DisplayMessage[] | null {
  const inMemory = pageMemory.get(key);
  // A failed quota write may have left an older value in storage. The page's
  // latest conversation, including an explicit clear, is authoritative.
  if (inMemory) return [...inMemory];
  let raw: string | null;
  try {
    raw = window.sessionStorage.getItem(key);
  } catch {
    storageFailures.add(key);
    return inMemory ? [...inMemory] : null;
  }
  if (!raw) return inMemory ? [...inMemory] : [];
  try {
    const parsed = JSON.parse(raw) as Partial<StoredHistory>;
    const contractId = decodeURIComponent(key.split(":").at(-1) ?? "");
    if (parsed.version !== VERSION || !validateMessages(parsed.messages) ||
        parsed.messages.some(message => message.answer && message.answer.contractId !== contractId)) {
      window.sessionStorage.removeItem(key);
      return inMemory ? [...inMemory] : [];
    }
    pageMemory.set(key, parsed.messages);
    return [...parsed.messages];
  } catch {
    try {
      window.sessionStorage.removeItem(key);
    } catch {
      // A malformed value is unusable even if the browser refuses removal.
    }
    return inMemory ? [...inMemory] : [];
  }
}

export function writeHistory(key: string, messages: DisplayMessage[]): boolean {
  pageMemory.set(key, [...messages]);
  try {
    window.sessionStorage.setItem(key, JSON.stringify({ version: VERSION, messages } satisfies StoredHistory));
    storageFailures.delete(key);
    return true;
  } catch {
    storageFailures.add(key);
    return false;
  }
}

export function clearHistoryKey(key: string): void {
  pageMemory.set(key, []);
  try {
    window.sessionStorage.removeItem(key);
    storageFailures.delete(key);
  } catch {
    storageFailures.add(key);
    // Storage may be disabled; the in-memory conversation is still cleared.
  }
}

export function clearAllFeatureHistory(): void {
  for (const key of pageMemory.keys()) pageMemory.set(key, []);
  try {
    for (let i = window.sessionStorage.length - 1; i >= 0; i--) {
      const key = window.sessionStorage.key(i);
      if (key?.startsWith(PREFIX)) window.sessionStorage.removeItem(key);
    }
  } catch {
    // Storage may be disabled.
  }
  clearListeners.forEach((listener) => listener());
}

export function subscribeToHistoryClear(listener: () => void): () => void {
  clearListeners.add(listener);
  return () => clearListeners.delete(listener);
}

export function clearObsoleteContextHistory(identity: string, context: string): void {
  const identityPrefix = `${PREFIX}${keyPart(identity)}:`;
  const currentPrefix = `${identityPrefix}${keyPart(context)}:`;
  for (const key of pageMemory.keys()) {
    if (key.startsWith(identityPrefix) && !key.startsWith(currentPrefix)) pageMemory.delete(key);
  }
  try {
    const obsolete: string[] = [];
    for (let i = 0; i < window.sessionStorage.length; i++) {
      const key = window.sessionStorage.key(i);
      if (key?.startsWith(identityPrefix) && !key.startsWith(currentPrefix)) obsolete.push(key);
    }
    obsolete.forEach((key) => window.sessionStorage.removeItem(key));
  } catch {
    // Storage may be disabled.
  }
}

export function providerHistory(messages: DisplayMessage[]): ChatMessage[] {
  const result: ChatMessage[] = [];
  for (let index = 0; index < messages.length - 1; index++) {
    const user = messages[index];
    const assistant = messages[index + 1];
    if (user.role === "user" && assistant.role === "assistant" &&
      assistant.answer &&
      ["ok", "truncated"].includes(assistant.answer.status) &&
      assistant.answer.answer.trim()) {
      result.push({ role: "user", content: user.content });
      result.push({ role: "assistant", content: assistant.answer.answer });
      index++;
    }
  }
  return result;
}
