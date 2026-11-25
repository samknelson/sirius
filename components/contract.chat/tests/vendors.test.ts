import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ContractChatArgs } from "../shared/types";


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

import "../server/plugins/wc-vendors/plugins/contract-chat-dummy";
import { wcRequest } from "../../../server/services/webclient";
import { getWcVendorPlugin } from "../../../server/plugins/wc-vendors/registry";
import { setMaintenanceActive } from "../../../server/services/maintenance-flag";

const ask: ContractChatArgs = {
  contractId: "remote-contract", role: "member",
  messages: [
    { role: "user", content: "First question" },
    { role: "assistant", content: "First answer" },
    { role: "user", content: "Follow-up" },
  ],
  userRef: "opaque-user", sessionRef: "opaque-session", mode: "pages",
};
function config(pluginId = "contract-chat-dummy", data: Record<string, unknown> = {}) {
  const row = { id: "chat-config", pluginKind: "wc-vendors", pluginId, enabled: true, name: "Test chat", data };
  state.configs = [row];
  return row;
}
const target = { configId: "chat-config" };

beforeEach(() => {
  state.http.mockReset(); state.stats.mockReset(); state.flood.mockReset(); state.cache.mockReset();
  state.component = true; state.writable = true; state.secret = "";
  setMaintenanceActive(false);
  config();
});
afterEach(() => setMaintenanceActive(false));

describe("Contract Chat dummy through the configuration/operation boundary", () => {
  it("declares the contract chat operations with correct gates, credentials, safety and manual forms", () => {
    const plugin = getWcVendorPlugin("contract-chat-dummy")!;
    expect(Object.keys(plugin.operations).sort()).toEqual([
      "contract.chat.ask", "contract.chat.catalog", "contract.chat.feedback",
      "contract.chat.route", "contract.chat.search", "service.test-connection",
    ]);
    expect(plugin.requiredComponent).toBe("contract.chat");
    expect(plugin.credential.secretName).toBe("none");
    for (const [operation, metadata] of Object.entries(plugin.operations)) {
      expect(metadata?.cacheMode).toBe("uncached");
      expect(metadata?.manualRun?.effect).toBe(
        ["contract.chat.ask", "contract.chat.route", "contract.chat.feedback"].includes(operation) ? "write" : "read",
      );
    }
    expect("run" in plugin.operations["contract.chat.ask"]!).toBe(false);
  });

  it("runs the dummy and operation assignment without credentials, network, usage or caching", async () => {
    config("contract-chat-dummy", { operations: ["contract.chat.ask"] });
    state.secret = "";
    const result = await wcRequest({ vendor: { any: true }, operation: "contract.chat.ask", args: { ...ask, contractId: "synthetic-contract" } });
    expect(result.value).toMatchObject({ status: "ok", costUsd: 0, notice: expect.stringContaining("SYNTHETIC") });
    expect(state.http).not.toHaveBeenCalled(); expect(state.stats).not.toHaveBeenCalled();
    expect(state.cache).not.toHaveBeenCalled();
    const feedback = await wcRequest({ vendor: target, operation: "contract.chat.feedback", args: { requestId: "synthetic-request", rating: "up" } });
    expect(feedback.value).toEqual({ ok: true, persisted: false });
    const entries = await wcRequest({ vendor: target, operation: "contract.chat.catalog", args: undefined });
    expect(entries.value?.[0].id).toBe("synthetic-contract");
    const search = await wcRequest({ vendor: target, operation: "contract.chat.search", args: { query: "meal" } });
    expect(search.value?.[0].article).toBeNull();
  });

  it.each(["refusal", "truncated"] as const)("preserves dummy %s answer outcomes", async (scenario) => {
    config("contract-chat-dummy", { scenario });
    const result = await wcRequest({ vendor: target, operation: "contract.chat.ask", args: { ...ask, contractId: "synthetic-contract" } });
    expect(result.value?.status).toBe(scenario);
  });
  it.each(["budget_exceeded", "rate_limited", "service_error"])("simulates %s explicitly", async (scenario) => {
    config("contract-chat-dummy", { scenario });
    const result = await wcRequest({ vendor: target, operation: "contract.chat.catalog", args: undefined });
    expect(result.error).toContain(scenario); expect(result.value).toBeUndefined();
  });
  it.each(["ask", "none", "meal breaks"])("routes dummy fixture %s", async (question) => {
    config("contract-chat-dummy", {});
    const result = await wcRequest({ vendor: target, operation: "contract.chat.route", args: { question } });
    expect(result.value?.kind).toBe(question === "meal breaks" ? "contract" : question);
  });
});
