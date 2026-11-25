import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ContractChatAnswer } from "../shared/types";

const state = vi.hoisted(() => ({
  settings: { providerConfigId: "selected" } as unknown,
  describe: vi.fn(), request: vi.fn(), component: true,
}));
vi.mock("../../../server/storage", () => ({
  storage: {
    variables: { getByName: async () => ({ value: state.settings }) },
    users: { getUserPermissions: async () => [{ key: "staff" }] },
  },
}));
vi.mock("../../../server/services/webclient/wc-vendor-context", () => ({ describeWcVendor: state.describe }));
vi.mock("../../../server/services/webclient/client", () => ({ wcRequest: state.request }));
vi.mock("../../../server/plugins/wc-vendors/registry", () => ({
  getWcVendorPlugin: () => ({
    service: "External provider",
    operations: Object.fromEntries(["catalog", "ask", "search", "route", "feedback"]
      .map((op) => [`contract.chat.${op}`, { cacheMode: "uncached" }])),
  }),
}));
vi.mock("../../../server/modules/components", () => ({
  requireComponent: () => (_req: unknown, res: any, next: () => void) =>
    state.component ? next() : res.status(403).json({ message: "disabled" }),
}));
vi.mock("../../../server/modules/masquerade", () => ({
  getEffectiveUser: async () => ({ dbUser: { id: "effective-user" } }),
}));

import { ask, catalog, resolveProvider, safeFailure } from "../server/service";
import { registerRoutes } from "../server/startup";
import { captureHttpPrivacy, isHttpBodyPrivate } from "../../../server/services/http-response-privacy";
import { providerWindow } from "../shared/experience";
import {
  clearAllFeatureHistory, clearHistoryKey, historyKey, historyStorageFailed,
  readHistory, validateMessages, writeHistory,
} from "../client/src/history";

const actor = { userId: "effective-user", sessionId: "random-login-session", role: "staff" as const };
const entry = {
  id: "opaque-provider-id", name: "Agreement", status: "current", notice: null,
  externalRef: null, termEnd: null, version: 1, documents: [],
};
const canary = "TRANSCRIPT-PRIVACY-CANARY";
const answer: ContractChatAnswer = {
  requestId: "provider-request", contractId: entry.id, contractName: entry.name, contractStatus: "current",
  externalRef: null, notice: null, answer: canary, citations: [{
    document: "Agreement", page: 1, endPage: 2, article: "1", section: null, quote: canary,
  }], status: "ok", error: null, likelyGrievance: null, scope: "in_contract",
};
function description(revision = "revision-1") {
  return {
    configId: "selected", pluginId: "dummy", pluginName: "Provider", configurationRevision: revision,
    operations: ["catalog", "ask", "search", "route", "feedback"].map((op) => `contract.chat.${op}`),
  };
}
const success = (value: unknown) => ({ source: "network", outcome: "success", fresh: true, value });
beforeEach(() => {
  state.settings = { providerConfigId: "selected" };
  state.component = true;
  state.describe.mockReset().mockResolvedValue(description());
  state.request.mockReset().mockImplementation(async ({ operation }) =>
    success(operation === "contract.chat.catalog" ? [entry] : answer));
  const values = new Map<string, string>();
  vi.stubGlobal("window", { sessionStorage: {
    get length() { return values.size; },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  } });
  clearAllFeatureHistory();
});

describe("Contract Chat authorization and provider boundary", () => {
  it.each([null, {}, { providerConfigId: null }, '{"providerConfigId":"selected"}'])(
    "never falls back when settings have no usable explicit choice: %j", async (settings) => {
      state.settings = settings;
      await expect(resolveProvider(actor)).rejects.toMatchObject({ status: 503 });
      expect(state.describe).not.toHaveBeenCalled();
      expect(state.request).not.toHaveBeenCalled();
    },
  );

  it("refuses a deleted/disabled/component-unavailable provider without exposing its diagnostic", async () => {
    state.describe.mockRejectedValue(new Error(canary));
    await expect(resolveProvider(actor)).rejects.toMatchObject({ code: "provider_unavailable" });
    try { await resolveProvider(actor); } catch (error) { expect(String(error)).not.toContain(canary); }
    expect(state.request).not.toHaveBeenCalled();
  });

  it("binds context to effective user, login session, trusted role and provider revision", async () => {
    const first = await resolveProvider(actor);
    for (const changed of [{ ...actor, userId: "other" }, { ...actor, sessionId: "other" }, { ...actor, role: "member" as const }]) {
      expect((await resolveProvider(changed)).context).not.toBe(first.context);
    }
    state.describe.mockResolvedValue(description("revision-2"));
    expect((await resolveProvider(actor)).context).not.toBe(first.context);
    expect(first.context).not.toContain(actor.sessionId);
  });

  it("refuses stale context, foreign contract IDs and browser role assertions before any paid call", async () => {
    const provider = await resolveProvider(actor);
    const body = { context: provider.context, contractId: entry.id, messages: [{ role: "user", content: canary }] };
    await expect(ask(actor, { ...body, role: "staff" })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(ask(actor, { ...body, context: "x".repeat(64) })).rejects.toMatchObject({ code: "context_changed" });
    await expect(ask(actor, { ...body, contractId: "foreign" })).rejects.toMatchObject({ code: "contract_unavailable" });
    expect(state.request.mock.calls.every(([call]) => call.operation === "contract.chat.catalog")).toBe(true);
  });

  it("rechecks provider selection after catalog loading and enforces the resolved revision", async () => {
    const provider = await resolveProvider(actor);
    state.request.mockImplementationOnce(async () => {
      state.describe.mockResolvedValue(description("changed-during-catalog"));
      return success([entry]);
    });
    await expect(ask(actor, { context: provider.context, contractId: entry.id, messages: [{ role: "user", content: canary }] }))
      .rejects.toMatchObject({ code: "context_changed" });
    expect(state.request).toHaveBeenCalledTimes(1);
    expect(state.request.mock.calls[0][0].expectedConfigurationRevision).toBe("revision-1");
  });

  it("uses server role/references and preserves partial text while replacing remote diagnostics", async () => {
    const provider = await resolveProvider(actor);
    state.request.mockImplementation(async ({ operation }) => success(operation === "contract.chat.catalog" ? [entry] :
      { ...answer, status: "truncated", error: { code: "budget_exceeded", message: `raw diagnostic ${canary}` } }));
    const result = await ask(actor, { context: provider.context, contractId: entry.id, messages: [{ role: "user", content: canary }] });
    expect(result).toMatchObject({ answer: canary, status: "truncated", citations: [{ quote: canary }] });
    expect(result.error).toMatchObject({ code: "budget_exceeded" });
    expect(result.error?.message).not.toContain(canary);
    const paid = state.request.mock.calls.find(([call]) => call.operation === "contract.chat.ask")![0];
    expect(paid.args).toMatchObject({ role: "staff", userRef: provider.userRef, sessionRef: provider.sessionRef });
    expect(paid.args.userRef).not.toContain(actor.userId);
  });

  it("does not retry failed envelopes or relay their error strings", async () => {
    const provider = await resolveProvider(actor);
    state.request.mockResolvedValue({ outcome: "failure", error: canary, cause: { code: "budget_exceeded", message: canary } });
    await expect(catalog(provider)).rejects.toMatchObject({ code: "budget_exceeded" });
    expect(state.request).toHaveBeenCalledTimes(1);
    expect(safeFailure({ code: canary, message: canary }).message).not.toContain(canary);
    expect(safeFailure({ code: "timeout" }).code).toBe("timeout");
    expect(safeFailure({ code: "rate_limited" }).code).toBe("rate_limited");
  });

  it("mounts auth, component and permission checks ahead of both feature endpoints", async () => {
    const mounted: any[] = [];
    const app = { use: (...args: any[]) => mounted.push(args), get: vi.fn(), post: vi.fn() };
    const auth = vi.fn((_req, _res, next) => next());
    const permission = vi.fn(() => vi.fn((_req, _res, next) => next()));
    registerRoutes(app as any, auth, permission, vi.fn() as any);
    expect(mounted[0][0]).toBe("/api/contract-chat");
    expect(permission).toHaveBeenCalledWith("contract.chat");
    const gates = mounted[0].slice(1);
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    state.component = false;
    const tail = vi.fn();
    await gates[1]({}, res, tail);
    expect(tail).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(app.get).toHaveBeenCalledWith("/api/contract-chat/context", expect.any(Function));
    expect(app.post).toHaveBeenCalledWith("/api/contract-chat/ask", expect.any(Function));
  });
});

describe("Contract Chat transient history and HTTP privacy", () => {
  it("marks the entire API scope private before parsing/auth, including unknown child endpoints", () => {
    for (const path of ["/api/contract-chat", "/api/contract-chat/ask", "/API/Contract-Chat/ASK", "/api/contract-chat/unknown"]) {
      const res = { setHeader: vi.fn(), vary: vi.fn() };
      captureHttpPrivacy({ path } as any, res as any, vi.fn());
      expect(isHttpBodyPrivate(res as any)).toBe(true);
      expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "private, no-store");
      expect(res.vary).toHaveBeenCalledWith("Cookie");
    }
    const unrelated = { setHeader: vi.fn(), vary: vi.fn() };
    captureHttpPrivacy({ path: "/api/contract-chat-unrelated" } as any, unrelated as any, vi.fn());
    expect(isHttpBodyPrivate(unrelated as any)).toBe(false);
  });

  it("keeps only complete bounded turns without losing the locally displayed history", () => {
    const history = Array.from({ length: 30 }, (_, index) => [
      { role: "user" as const, content: `Question ${index}` },
      { role: "assistant" as const, content: `Answer ${index}` },
    ]).flat();
    const result = providerWindow([...history, { role: "user", content: "Failed" }], "Next");
    expect(result).toHaveLength(19);
    expect(result[0].content).toBe("Question 21");
    expect(result.at(-1)).toEqual({ role: "user", content: "Next" });
    expect(history).toHaveLength(60);
  });

  it("isolates keys and rejects corrupt nested citation fields", () => {
    const key = historyKey("one", "login-provider-1", entry.id);
    writeHistory(key, [{ role: "assistant", content: canary, answer }]);
    expect(readHistory(historyKey("two", "login-provider-1", entry.id))).toEqual([]);
    expect(readHistory(historyKey("one", "login-provider-2", entry.id))).toEqual([]);
    expect(validateMessages([{ role: "assistant", content: canary, answer: { ...answer, citations: [null] } }])).toBe(false);
  });

  it("retains latest page memory after quota errors and does not resurrect cleared storage", () => {
    const key = historyKey("quota-user", "context", entry.id);
    writeHistory(key, [{ role: "user", content: "Old" }]);
    window.sessionStorage.setItem = () => { throw new Error("Quota"); };
    expect(writeHistory(key, [{ role: "user", content: canary }])).toBe(false);
    expect(readHistory(key)?.[0].content).toBe(canary);
    expect(historyStorageFailed(key)).toBe(true);
    window.sessionStorage.removeItem = () => { throw new Error("Disabled"); };
    clearHistoryKey(key);
    expect(readHistory(key)).toEqual([]);
  });
});
