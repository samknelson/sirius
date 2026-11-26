import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";

const state = vi.hoisted(() => ({ enabled: true, dispatch: true, admin: true, signedIn: true, permission: vi.fn(), effective: vi.fn(), sql: vi.fn() }));
vi.mock("../../../server/storage", () => ({ storage: {
  users: { userHasPermission: state.permission },
  workerTrustElections: { getActiveViewByWorker: async () => null },
} }));
vi.mock("../../../server/logger", () => ({ storageLogger: { info: vi.fn() }, logger: { error: vi.fn() } }));
vi.mock("../../../server/modules/masquerade", () => ({ getEffectiveUser: state.effective }));
vi.mock("../server/storage/eligible-workers", () => ({ eligibleWorkersSql: state.sql }));
vi.mock("../../../server/storage/unified-options", () => ({ createUnifiedOptionsStorage: () => ({}) }));
vi.mock("../../../server/plugins/trust/eligibility/plugins/sitespecific-bao-buildup", () => ({ fetchBuildupStatus: vi.fn() }));
vi.mock("../../../server/plugins/ledger/charge/plugins/sitespecific-bao-echp", () => ({
  loadEchpSettings: vi.fn(), isEchpEnabledForPolicy: vi.fn(), resolveEchpQuote: vi.fn(),
}));
vi.mock("../../../server/services/access-policy-evaluator", () => ({
  requireAccess: () => (_req: any, res: any, next: any) => {
    if (!state.signedIn) return res.status(401).json({ message: "Unauthorized" });
    if (!state.admin) return res.status(403).json({ message: "Forbidden" });
    next();
  },
}));
vi.mock("../../../server/modules/components", () => ({
  requireComponent: (id: string) => (_req: any, res: any, next: any) => {
    if (!(id === "debug" ? state.enabled : state.dispatch)) return res.status(403).json({ message: "Disabled" });
    next();
  },
}));
import { register, registerRoutes } from "../server/startup";
import { alterHooks } from "@shared/alter";
import { registerBaoEchpRoutes } from "../../../server/modules/sitespecific/bao/echp";
import { requireAccess } from "../../../server/services/access-policy-evaluator";
import { logCleanupDefaults } from "../../../server/plugins/system/cron/log-cleanup-defaults";
import { observeSaml } from "../../../server/auth/saml-observation";

let server: Server;
let base: string;
beforeAll(async () => {
  register();
  alterHooks.close({ isKnown: () => true, isEnabled: () => state.enabled, isEnabledSync: () => state.enabled });
  const app = express();
  registerRoutes(app, undefined as any, undefined as any, undefined as any);
  registerBaoEchpRoutes(app, (_req, _res, next) => next(), undefined as any, requireAccess);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
afterAll(() => new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); }));
beforeEach(() => {
  state.enabled = state.dispatch = state.admin = state.signedIn = true;
  state.permission.mockReset().mockResolvedValue(true);
  state.effective.mockReset().mockResolvedValue({ dbUser: { id: "effective-user" } });
  state.sql.mockReset().mockResolvedValue({ sql: "private-sql", params: [], appliedConditions: [] });
});
describe("component registration", () => {
  it.each(["GET", "POST"])("uses the same effective-admin override for %s", async method => {
    const endpoint = method === "GET" ? "eligibility" : "purchase";
    const response = await fetch(`${base}/api/sitespecific/bao/echp/worker/fixture/${endpoint}?asOf=2026-02-04`, { method });
    expect(response.status).toBe(method === "GET" ? 200 : 409);
    const result = await response.json();
    expect(result).toMatchObject({ asOf: { year: 2026, month: 2, day: 4 }, asOfApplied: true, code: "no_active_election" });
    expect(state.permission).toHaveBeenCalledWith("effective-user", "admin");
  });
  it.each(["disabled", "non-admin", "missing-user", "invalid-date"])("ignores %s date overrides", async condition => {
    if (condition === "disabled") state.enabled = false;
    if (condition === "non-admin") state.permission.mockResolvedValue(false);
    if (condition === "missing-user") state.effective.mockResolvedValue({ dbUser: null });
    for (const method of ["GET", "POST"]) {
      const endpoint = method === "GET" ? "eligibility" : "purchase";
      const result = await fetch(`${base}/api/sitespecific/bao/echp/worker/fixture/${endpoint}?asOf=${condition === "invalid-date" ? "2026-13-02" : "2026-02-04"}`, { method }).then(r => r.json());
      const now = new Date();
      expect(result).toMatchObject({ asOf: { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() }, asOfApplied: false });
    }
  });
  it("offers only an opt-in cleanup suggestion while enabled", () => {
    expect(logCleanupDefaults().policies).toEqual([{ module: "saml_debug", operation: null, retentionDays: 7, enabled: false }]);
    state.enabled = false;
    expect(logCleanupDefaults().policies).toEqual([]);
  });
  it.each(["success", "access_denied", "saml_error"] as const)("observes %s without affecting authentication", outcome => {
    expect(() => observeSaml({ body: { SAMLResponse: "fixture" } } as any, outcome)).not.toThrow();
  });
  it.each(["anonymous", "non-admin", "disabled", "dispatch-disabled"])("refuses direct diagnostics for %s", async condition => {
    if (condition === "anonymous") state.signedIn = false;
    if (condition === "non-admin") state.admin = false;
    if (condition === "disabled") state.enabled = false;
    if (condition === "dispatch-disabled") state.dispatch = false;
    const endpoints = condition === "dispatch-disabled" ? ["/api/dispatch-jobs/job/eligible-workers-sql"] : [
      "/api/admin/debug/event-bus/catalog", "/api/admin/debug/event-bus/recent",
      "/api/dispatch-jobs/job/eligible-workers-sql",
    ];
    for (const path of endpoints) {
      const response = await fetch(base + path);
      expect(response.status).toBe(condition === "anonymous" ? 401 : 403);
      expect(await response.text()).not.toContain("private-sql");
    }
    expect(state.sql).not.toHaveBeenCalled();
    if (condition !== "dispatch-disabled") {
      const response = await fetch(`${base}/api/admin/debug/event-bus/clear`, { method: "POST" });
      expect(response.status).toBe(condition === "anonymous" ? 401 : 403);
    }
  });
});
