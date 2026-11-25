import { createHash } from "node:crypto";
import { z } from "zod";
import { storage } from "../../../server/storage";
import { describeWcVendor } from "../../../server/services/webclient/wc-vendor-context";
import { wcRequest } from "../../../server/services/webclient/client";
import { getWcVendorPlugin } from "../../../server/plugins/wc-vendors/registry";
import type { WcResult } from "../../../server/services/webclient/types";
import { CONTRACT_CHAT_OPERATIONS, CONTRACT_CHAT_SETTINGS_VARIABLE, parseContractChatSettings } from "../shared/settings";
import type { ContractChatAnswer, ContractChatCatalogEntry } from "../shared/types";
import { askArgs } from "./contract";

export class ChatError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
  }
}

const failures = {
  rate_limited: "The request limit was reached. Wait before explicitly trying again.",
  budget_exceeded: "The provider budget was reached. Contact an administrator.",
  timeout: "The provider did not finish in time. It may have processed this question; retrying may incur another charge.",
  provider_error: "The provider could not complete this request. Retrying may incur another charge.",
  unavailable: "Contract Chat is temporarily unavailable. No automatic retry was made.",
} as const;

/** Classify only known machine fields. Never return a raw remote message. */
export function safeFailure(error: unknown): ChatError {
  if (error instanceof ChatError) return error;
  const value = error && typeof error === "object" ? error as { code?: unknown; status?: unknown; statusCode?: unknown } : {};
  const code = typeof value.code === "string" ? value.code.toLowerCase() : "";
  if (["budget_exceeded", "budget_limit_exceeded"].includes(code)) return new ChatError(429, "budget_exceeded", failures.budget_exceeded);
  if (["rate_limited", "rate_limit_exceeded", "wc_rate_limited"].includes(code) || value.status === 429 || value.statusCode === 429) {
    return new ChatError(429, "rate_limited", failures.rate_limited);
  }
  if (["timeout", "wc_timeout"].includes(code) || value.status === 504 || value.statusCode === 504) {
    return new ChatError(504, "timeout", failures.timeout);
  }
  if (value.status === 409) return new ChatError(409, "context_changed", "Provider context changed. Reload the catalog and select a contract again.");
  return new ChatError(503, "provider_error", failures.provider_error);
}

const hash = (parts: unknown[]) => createHash("sha256").update(JSON.stringify(parts)).digest("hex");
export interface ChatActor { userId: string; sessionId: string; role: "staff" | "member" }

export async function resolveProvider(actor: ChatActor) {
  const row = await storage.variables.getByName(CONTRACT_CHAT_SETTINGS_VARIABLE);
  const parsed = parseContractChatSettings(row?.value);
  if (!parsed.valid) throw new ChatError(503, "settings_invalid", "Contract Chat settings are invalid. Contact an administrator.");
  const id = parsed.settings.providerConfigId;
  if (!id) throw new ChatError(503, "provider_missing", "No Contract Chat provider has been selected. Contact an administrator.");
  try {
    const provider = await describeWcVendor({ configId: id });
    const plugin = getWcVendorPlugin(provider.pluginId);
    if (!plugin || !CONTRACT_CHAT_OPERATIONS.every((op) =>
      provider.operations.includes(op) && plugin.operations[op]?.cacheMode === "uncached")) throw new Error("Unsupported provider");
    return {
      id,
      revision: provider.configurationRevision,
      name: provider.pluginName,
      external: Boolean(plugin.service),
      context: hash(["contract-chat-v1", actor.userId, actor.sessionId, actor.role, id, provider.configurationRevision]),
      userRef: hash(["contract-chat-user", actor.userId]),
      sessionRef: hash(["contract-chat-session", actor.sessionId, actor.userId]),
    };
  } catch {
    throw new ChatError(503, "provider_unavailable", "The saved Contract Chat provider is unavailable. Contact an administrator or retry the catalog.");
  }
}

type Provider = Awaited<ReturnType<typeof resolveProvider>>;
function resultValue<T>(result: WcResult<T>): T {
  if (result.outcome === "success" && result.value !== undefined) return result.value;
  if (result.cause) throw safeFailure(result.cause);
  throw new ChatError(503, "unavailable", failures.unavailable);
}

const contractStatus = z.enum(["current", "expired", "side_document"]);
const catalogSchema = z.array(z.object({
  id: z.string().min(1), name: z.string(), status: contractStatus, notice: z.string().nullable(),
  externalRef: z.string().nullable(), termEnd: z.string().nullable(), version: z.number(),
  documents: z.array(z.object({ id: z.string(), name: z.string() })),
}));
const answerSchema = z.object({
  requestId: z.string(), contractId: z.string(), contractName: z.string(),
  contractStatus, externalRef: z.string().nullable(), notice: z.string().nullable(),
  answer: z.string(), status: z.enum(["ok", "truncated", "refusal", "timeout", "error", "client_closed"]),
  citations: z.array(z.object({
    document: z.string(), page: z.number().int().positive(), endPage: z.number().int().positive(),
    article: z.string().nullable(), section: z.string().nullable(), quote: z.string(),
  })),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
  likelyGrievance: z.boolean().nullable(),
  scope: z.enum(["in_contract", "not_in_contract", "off_purpose"]).nullable(),
});

export async function catalog(provider: Provider): Promise<ContractChatCatalogEntry[]> {
  const result = await wcRequest({
    vendor: { configId: provider.id }, operation: "contract.chat.catalog", args: undefined,
    expectedConfigurationRevision: provider.revision,
  });
  const parsed = catalogSchema.safeParse(resultValue(result));
  if (!parsed.success || new Set(parsed.data.map((item) => item.id)).size !== parsed.data.length) {
    throw new ChatError(502, "provider_error", "The provider returned an invalid catalog.");
  }
  return parsed.data;
}

const inputSchema = z.object({
  context: z.string().length(64), contractId: z.string().min(1),
  messages: askArgs.innerType().shape.messages,
}).strict();

export async function ask(actor: ChatActor, input: unknown): Promise<ContractChatAnswer> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) throw new ChatError(400, "invalid_input", "Choose a contract and submit a bounded conversation of alternating messages.");
  const provider = await resolveProvider(actor);
  if (provider.context !== parsed.data.context) {
    throw new ChatError(409, "context_changed", "Provider or login context changed. Reload the catalog and select a contract again.");
  }
  const validated = askArgs.safeParse({
    contractId: parsed.data.contractId, messages: parsed.data.messages,
    role: actor.role, userRef: provider.userRef, sessionRef: provider.sessionRef,
  });
  if (!validated.success) throw new ChatError(400, "invalid_input", "Messages must alternate, begin and end with a question, and stay within the message and character limits.");
  const contracts = await catalog(provider);
  if (!contracts.some((item) => item.id === validated.data.contractId)) {
    throw new ChatError(400, "contract_unavailable", "This contract is no longer in the provider catalog. Select a contract again.");
  }
  // Settings can change while the catalog is in flight. Never send an old
  // transcript to a newly selected connection, even if its contract IDs match.
  if ((await resolveProvider(actor)).context !== provider.context) {
    throw new ChatError(409, "context_changed", "Provider context changed. Reload the catalog before submitting.");
  }
  const result = await wcRequest({
    vendor: { configId: provider.id }, operation: "contract.chat.ask", args: validated.data,
    expectedConfigurationRevision: provider.revision,
  });
  const answer = answerSchema.safeParse(resultValue(result));
  if (!answer.success || answer.data.contractId !== validated.data.contractId) {
    throw new ChatError(502, "provider_error", "The provider returned an invalid answer. No automatic retry was made.");
  }
  const response = answer.data;
  if (response.status === "ok" && !response.answer.trim() && !response.citations.length) {
    response.status = "error";
    response.error = { code: "provider_error", message: "The provider returned no answer. No automatic retry was made." };
    return response;
  }
  // Preserve useful partial content, but never relay arbitrary diagnostic text.
  if (response.error) {
    if (response.status === "refusal") {
      response.error = { code: "refusal", message: "The provider declined to answer this question." };
    } else {
      const safe = safeFailure({ code: response.error.code });
      response.error = { code: safe.code, message: safe.message };
    }
  }
  return response;
}
