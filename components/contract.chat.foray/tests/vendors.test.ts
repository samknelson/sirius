import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ContractChatArgs } from "../../contract.chat/shared/types";


const state = vi.hoisted(() => ({
  configs: [] as Array<Record<string, any>>,
  component: true, writable: true, secret: 'synthetic-token/+"canary',
  http: vi.fn(), stats: vi.fn(), flood: vi.fn(), cache: vi.fn(),
}));
vi.mock("../../../server/storage", () => ({
  storage: { pluginConfigs: {
    get: async (id: string) => state.configs.find((c) => c.id === id),
    getByKind: async () => state.configs,
    getByKindAndPlugin: async (_kind: string, id: string) => state.configs.filter((c) => c.pluginId === id),
  } },
}));
vi.mock("../../../server/plugins/_core/gating", () => ({
  isPluginComponentEnabledAsync: async () => state.component,
}));
vi.mock("../../../server/storage/transaction-context", () => ({
  runOutsideTransaction: (fn: () => unknown) => fn(),
}));
vi.mock("../../../server/storage/wc-cache", () => ({
  wcRequestKeyHash: () => "unused",
  wcCacheStorage: {
    canStore: async () => state.writable,
    read: state.cache, writeSuccess: state.cache, writeFailure: state.cache,
  },
}));
vi.mock("../../../server/storage/wc-stats", () => ({ wcStatsStorage: { recordCall: state.stats } }));
vi.mock("../../../server/flood/service", () => ({
  enforceConfiguredFloodLimits: state.flood,
  FloodError: class extends Error {
    pluginConfigurationId = "flood-config";
    threshold = 1;
    windowSeconds = 60;
  },
}));
vi.mock("../../../server/config/env-registry", () => ({
  registerEnvironmentVariable: vi.fn(), registerEnvironmentVariables: vi.fn(),
  listEnvironmentVariables: () => [],
  getEnvironmentVariable: (name: string) => name === "CHAT_TEST_TOKEN" ? state.secret : undefined,
}));
// Retain the real URL/destination validation while replacing ONLY the network.
// Socket DNS behavior has its own vendor-http tests; this suite must stay offline.
vi.mock("../../../server/services/webclient/vendor-http", async (original) => {
  const actual = await original<typeof import("../../../server/services/webclient/vendor-http")>();
  return {
    ...actual,
    createVendorHttp: (pluginId: string, policy: () => any) => {
      let refused: unknown;
      return {
        async fetch(url: string, init: RequestInit) {
          try { actual.validateVendorUrl(pluginId, url, policy()); }
          catch (error) { refused = error; throw error; }
          return state.http(url, init);
        },
        throwIfRefused() { if (refused) throw refused; },
      };
    },
  };
});

import "../server/plugins/wc-vendors/plugins/contract-chat-foray";
import { wcRequest } from "../../../server/services/webclient";
import { getWcVendorPlugin } from "../../../server/plugins/wc-vendors/registry";
import { setMaintenanceActive } from "../../../server/services/maintenance-flag";
import { WcEndpointPolicyError, WcRateLimitError } from "../../../server/services/webclient/refusals";
import { FloodError } from "../../../server/flood/service";
import { validateAgainstSchema } from "../../../server/utils/json-schema-validator";
import { manualSchemas, validateAsk } from "../../contract.chat/server/contract";

const ask: ContractChatArgs = {
  contractId: "remote-contract", role: "member",
  messages: [
    { role: "user", content: "First question" },
    { role: "assistant", content: "First answer" },
    { role: "user", content: "Follow-up" },
  ],
  userRef: "opaque-user", sessionRef: "opaque-session", mode: "pages",
};
const catalog = { contracts: [{
  id: "remote-contract", name: "Agreement", status: "expired", notice: "Expired agreement",
  external_ref: "sirius-contract-ref", term_end: "2025-12-31", version: 2,
  docs: [{ id: "doc", name: "Agreement.pdf" }],
}] };
const answer = {
  request_id: "request-1", contract_id: "remote-contract", contract_name: "Agreement",
  contract_status: "expired", notice: "Expired agreement", external_ref: "sirius-contract-ref",
  status: "ok", answer: "Answer", citations: [{
    document: "Agreement.pdf", page: 3, end_page: 4, article: null, section: null, quote: "Quoted text",
  }], error: null, likely_grievance: false, scope: "in_contract",
  usage: { input_tokens: 11, output_tokens: 12, cache_read_input_tokens: 13, cache_creation_input_tokens: 14 },
  cost_usd: 0.03, latency_ms: 15, ttft_ms: null, model: "test-model", stop_reason: "end_turn",
};
function config(pluginId = "contract-chat-foray", data: Record<string, unknown> = { secretName: "CHAT_TEST_TOKEN" }) {
  const row = { id: "chat-config", pluginKind: "wc-vendors", pluginId, enabled: true, name: "Test chat", data };
  state.configs = [row];
  return row;
}
function json(value: unknown, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(value), { status, headers });
}
const target = { configId: "chat-config" };

beforeEach(() => {
  state.http.mockReset(); state.stats.mockReset(); state.flood.mockReset(); state.cache.mockReset();
  state.component = true; state.writable = true; state.secret = 'synthetic-token/+"canary';
  state.http.mockResolvedValue(json(catalog));
  setMaintenanceActive(false);
  config();
});
afterEach(() => setMaintenanceActive(false));

describe("Contract Chat Foray through the configuration/operation boundary", () => {
  it("declares the contract chat operations with correct gates, credentials, safety and manual forms", () => {
    const plugin = getWcVendorPlugin("contract-chat-foray")!;
    expect(Object.keys(plugin.operations).sort()).toEqual([
      "contract.chat.ask", "contract.chat.catalog", "contract.chat.feedback",
      "contract.chat.route", "contract.chat.search", "service.test-connection",
    ]);
    expect(plugin.requiredComponent).toBe("contract.chat.foray");
    expect(plugin.credential.secretName).toBe("required");
    for (const [operation, metadata] of Object.entries(plugin.operations)) {
      expect(metadata?.cacheMode).toBe("uncached");
      expect(metadata?.manualRun?.effect).toBe(
        ["contract.chat.ask", "contract.chat.route", "contract.chat.feedback"].includes(operation) ? "write" : "read",
      );
    }
    expect("run" in plugin.operations["contract.chat.ask"]!).toBe(false);
    expect(plugin.validateConfig!({ baseUrl: "http://bad.test" }).valid).toBe(false);
    expect(plugin.validateConfig!({}).valid).toBe(true);
  });

  it("authenticates connection tests against catalog, never public health", async () => {
    const result = await wcRequest({ vendor: target, operation: "service.test-connection", args: undefined });
    expect(result.value?.status).toBe("connected");
    expect(state.http).toHaveBeenCalledExactlyOnceWith(
      "https://cba-service.foray-consulting.workers.dev/v1/contracts",
      expect.objectContaining({ method: "GET", headers: expect.objectContaining({ Authorization: `Bearer ${state.secret}` }) }),
    );
    state.http.mockResolvedValue(json({ error: "Invalid API key." }, 401));
    const rejected = await wcRequest({ vendor: target, operation: "service.test-connection", args: undefined });
    expect(rejected.value).toMatchObject({ status: "misconfigured", error: { code: "http_401" } });
  });

  it("maps catalog, full JSON conversation, citations, metadata, usage and feedback", async () => {
    const entries = await wcRequest({ vendor: target, operation: "contract.chat.catalog", args: undefined });
    expect(entries.value?.[0]).toMatchObject({ id: "remote-contract", externalRef: "sirius-contract-ref", documents: [{ id: "doc", name: "Agreement.pdf" }] });
    state.http.mockResolvedValue(json(answer));
    const result = await wcRequest({ vendor: target, operation: "contract.chat.ask", args: ask });
    expect(JSON.parse(state.http.mock.lastCall![1].body)).toEqual({
      contract_id: ask.contractId, role: ask.role, messages: ask.messages,
      user_ref: ask.userRef, session_ref: ask.sessionRef, mode: "pages", stream: false,
    });
    expect(state.http.mock.lastCall![1].timeoutMs).toBe(180_000);
    expect(result.value).toMatchObject({
      requestId: "request-1", contractStatus: "expired", notice: "Expired agreement",
      citations: [{ page: 3, endPage: 4, article: null, section: null }],
      usage: { inputTokens: 11, cacheCreationInputTokens: 14 }, costUsd: 0.03, timeToFirstTokenMs: null,
    });
    state.http.mockResolvedValue(json({ ok: true }));
    const feedback = await wcRequest({ vendor: target, operation: "contract.chat.feedback", args: { requestId: "request-1", rating: "down", comment: "Needs work" } });
    expect(feedback.value).toEqual({ ok: true, persisted: true });
    expect(JSON.parse(state.http.mock.lastCall![1].body)).toEqual({ request_id: "request-1", rating: "down", comment: "Needs work" });
    expect(state.cache).not.toHaveBeenCalled();
  });

  it.each(["truncated", "refusal", "timeout", "error", "client_closed"])("keeps HTTP-200 %s as a non-success answer", async (status) => {
    state.http.mockResolvedValue(json({ ...answer, status, error: { code: status, message: "Stopped" } }));
    const result = await wcRequest({ vendor: target, operation: "contract.chat.ask", args: ask });
    expect(result.value).toMatchObject({ status, answer: "Answer", error: { code: status }, requestId: "request-1" });
  });

  it("maps search fields and structured route choices", async () => {
    state.http.mockResolvedValue(json({ results: [{
      contract_id: "remote-contract", contract: "Agreement", contract_status: "expired", notice: "Expired",
      document: "Agreement.pdf", doc_id: "doc", page: 2, article: null, section: null, snippet: "Match",
    }] }));
    const found = await wcRequest({ vendor: target, operation: "contract.chat.search", args: { query: "meal", contractIds: ["remote-contract"], limit: 5 } });
    expect(found.value?.[0]).toMatchObject({ contractId: "remote-contract", documentId: "doc", article: null, notice: "Expired" });
    expect(JSON.parse(state.http.mock.lastCall![1].body)).toEqual({ query: "meal", contract_ids: ["remote-contract"], limit: 5 });
    for (const route of ["ask", "none", "remote-contract"]) {
      state.http.mockResolvedValue(json({ route }));
      const result = await wcRequest({ vendor: target, operation: "contract.chat.route", args: { question: "meal" } });
      expect(result.value).toEqual(route === "remote-contract" ? { kind: "contract", contractId: route } : { kind: route });
    }
  });

  it("rejects invalid histories/limits before HTTP and never truncates", async () => {
    const invalid = [
      { ...ask, messages: [{ role: "user", content: "x".repeat(4001) }] },
      { ...ask, messages: [{ role: "user", content: " " }] },
      { ...ask, messages: [{ role: "assistant", content: "x" }] },
      { ...ask, messages: ask.messages.slice(0, 2) },
      { ...ask, messages: [ask.messages[0], { role: "assistant", content: "x".repeat(20001) }, ask.messages[2]] },
      { ...ask, messages: Array.from({ length: 21 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: "x" })) },
    ];
    for (const input of invalid) {
      const result = await wcRequest({ vendor: target, operation: "contract.chat.ask", args: input as ContractChatArgs });
      expect(result.error).toContain("Invalid contract chat arguments");
    }
    const limit = await wcRequest({ vendor: target, operation: "contract.chat.search", args: { query: "meal", limit: 51 } });
    expect(limit.error).toBeDefined();
    expect(state.http).not.toHaveBeenCalled();
    expect(validateAgainstSchema(manualSchemas.ask, ask).valid).toBe(true);
    expect(validateAgainstSchema(manualSchemas.search, { query: "meal", limit: 51 }).valid).toBe(false);
    expect(validateAsk({ ...ask, messages: [{ role: "user", content: "x".repeat(4000) }] }).messages[0].content).toHaveLength(4000);
  });

  it("rejects disabled components/configs and missing secrets before dispatch", async () => {
    state.component = false;
    await expect(wcRequest({ vendor: target, operation: "contract.chat.catalog", args: undefined })).rejects.toThrow("not enabled");
    state.component = true;
    state.configs[0].enabled = false;
    await expect(wcRequest({ vendor: target, operation: "contract.chat.catalog", args: undefined })).rejects.toThrow("disabled");
    config("contract-chat-foray", {});
    await expect(wcRequest({ vendor: target, operation: "contract.chat.catalog", args: undefined })).rejects.toThrow("does not name");
    config(); state.secret = "";
    await expect(wcRequest({ vendor: target, operation: "contract.chat.catalog", args: undefined })).rejects.toThrow("not set");
    expect(state.http).not.toHaveBeenCalled();
  });

  it("preserves maintenance, destination, writable and flood refusals", async () => {
    setMaintenanceActive(true);
    await expect(wcRequest({ vendor: target, operation: "contract.chat.catalog", args: undefined })).rejects.toThrow("maintenance");
    setMaintenanceActive(false);
    state.writable = false;
    const readonly = await wcRequest({ vendor: target, operation: "contract.chat.ask", args: ask });
    expect(readonly.value).toBeUndefined();
    state.writable = true;
    config("contract-chat-foray", { secretName: "CHAT_TEST_TOKEN", baseUrl: "https://attacker.example" });
    await expect(wcRequest({ vendor: target, operation: "contract.chat.catalog", args: undefined })).rejects.toBeInstanceOf(WcEndpointPolicyError);
    config();
    state.flood.mockRejectedValue(new FloodError("test", 2, 1, 60));
    await expect(wcRequest({ vendor: target, operation: "contract.chat.catalog", args: undefined })).rejects.toBeInstanceOf(WcRateLimitError);
    expect(state.http).not.toHaveBeenCalled();
  });

  it("rejects malformed responses, never fabricates success or relays credential echoes", async () => {
    for (const response of [json({ contracts: null }), new Response("<html>bad</html>")]) {
      state.http.mockResolvedValue(response);
      const result = await wcRequest({ vendor: target, operation: "contract.chat.catalog", args: undefined });
      expect(result.value).toBeUndefined(); expect(result.error).toMatch(/malformed|invalid JSON/);
    }
    state.http.mockResolvedValue(json({ ...answer, answer: `${state.secret} ${encodeURIComponent(state.secret)}` }));
    const echoed = await wcRequest({ vendor: target, operation: "contract.chat.ask", args: ask });
    expect(echoed.value?.answer).not.toContain(state.secret);
    state.http.mockResolvedValue(json({ error: `Denied ${state.secret}`, code: "budget_exceeded", request_id: "req-limit" }, 429, { "x-echo": state.secret }));
    const refused = await wcRequest({ vendor: target, operation: "contract.chat.ask", args: ask });
    expect(refused.error).toContain("budget_exceeded"); expect(refused.error).toContain("req-limit");
    expect(JSON.stringify(refused)).not.toContain(state.secret);
    state.http.mockRejectedValue(new Error(`Transport headers Bearer ${state.secret}`));
    const failed = await wcRequest({ vendor: target, operation: "contract.chat.ask", args: ask });
    expect(failed.error).toContain("Could not reach Foray"); expect(JSON.stringify(failed)).not.toContain(state.secret);
  });
});
