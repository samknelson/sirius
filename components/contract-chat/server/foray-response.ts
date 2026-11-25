import { z } from "zod";
import type {
  ContractChatAnswer, ContractChatCatalogEntry, ContractChatSearchHit,
} from "../shared/types";
import { WcVendorError } from "../../../server/plugins/wc-vendors/errors";

const status = z.enum(["current", "expired", "side_document"]);
const nullableText = z.string().nullable();
const count = z.number().int().nonnegative();
const duration = z.number().nonnegative();
const catalog = z.object({
  contracts: z.array(z.object({
    id: z.string().min(1), name: z.string(), status, notice: nullableText,
    external_ref: nullableText, term_end: nullableText, version: count,
    docs: z.array(z.object({ id: z.string(), name: z.string() })),
  })),
});
const answer = z.object({
  request_id: z.string().min(1), contract_id: z.string().min(1), contract_name: z.string(),
  contract_status: status, external_ref: nullableText, notice: nullableText,
  answer: z.string(), citations: z.array(z.object({
    document: z.string(), page: z.number().int().positive(), end_page: z.number().int().positive(),
    article: nullableText, section: nullableText, quote: z.string(),
  })),
  status: z.enum(["ok", "truncated", "refusal", "timeout", "error", "client_closed"]),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
  likely_grievance: z.boolean().nullable(),
  scope: z.enum(["in_contract", "not_in_contract", "off_purpose"]).nullable(),
  usage: z.object({
    input_tokens: count, output_tokens: count,
    cache_read_input_tokens: count, cache_creation_input_tokens: count,
  }).optional(),
  cost_usd: duration.optional(), latency_ms: duration.optional(),
  ttft_ms: duration.nullable().optional(), model: z.string().optional(),
  stop_reason: nullableText.optional(),
});
const search = z.object({
  results: z.array(z.object({
    contract_id: z.string(), contract: z.string(), contract_status: status, notice: nullableText,
    document: z.string(), doc_id: z.string(), page: z.number().int().positive(),
    article: nullableText, section: nullableText, snippet: z.string(),
  })),
});

export class ContractChatProviderError extends WcVendorError {
  constructor(
    statusCode: number, message: string,
    public readonly code: string,
    public readonly requestId?: string,
  ) {
    super(statusCode, message);
    this.name = "ContractChatProviderError";
  }
}

export function parseResponse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    // Do not embed remote values or schema errors (which may contain content).
    throw new ContractChatProviderError(502, "Foray returned a malformed response.", "malformed_response");
  }
  return result.data;
}

export function mapCatalog(value: unknown): ContractChatCatalogEntry[] {
  return parseResponse(catalog, value).contracts.map((c) => ({
    id: c.id, name: c.name, status: c.status, notice: c.notice,
    externalRef: c.external_ref, termEnd: c.term_end, version: c.version, documents: c.docs,
  }));
}

export function mapAnswer(value: unknown): ContractChatAnswer {
  const a = parseResponse(answer, value);
  return {
    requestId: a.request_id, contractId: a.contract_id, contractName: a.contract_name,
    contractStatus: a.contract_status, externalRef: a.external_ref, notice: a.notice,
    answer: a.answer, status: a.status, error: a.error, likelyGrievance: a.likely_grievance,
    scope: a.scope,
    citations: a.citations.map((c) => ({
      document: c.document, page: c.page, endPage: c.end_page,
      article: c.article, section: c.section, quote: c.quote,
    })),
    ...(a.usage ? { usage: {
      inputTokens: a.usage.input_tokens, outputTokens: a.usage.output_tokens,
      cacheReadInputTokens: a.usage.cache_read_input_tokens,
      cacheCreationInputTokens: a.usage.cache_creation_input_tokens,
    } } : {}),
    ...(a.cost_usd !== undefined ? { costUsd: a.cost_usd } : {}),
    ...(a.latency_ms !== undefined ? { latencyMs: a.latency_ms } : {}),
    ...(a.ttft_ms !== undefined ? { timeToFirstTokenMs: a.ttft_ms } : {}),
    ...(a.model !== undefined ? { model: a.model } : {}),
    ...(a.stop_reason !== undefined ? { stopReason: a.stop_reason } : {}),
  };
}

export function mapSearch(value: unknown): ContractChatSearchHit[] {
  return parseResponse(search, value).results.map((h) => ({
    contractId: h.contract_id, contractName: h.contract, contractStatus: h.contract_status,
    notice: h.notice, document: h.document, documentId: h.doc_id,
    page: h.page, article: h.article, section: h.section, snippet: h.snippet,
  }));
}
