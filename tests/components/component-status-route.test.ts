import express from "express";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../server/storage/system/component-ownership", () => ({
  componentOwnershipStorage: { read: async () => ({}) },
}));

const mocks = vi.hoisted(() => ({
  read: vi.fn(), refresh: vi.fn(), enabled: vi.fn(() => { throw new Error("Broken cache getter"); }),
}));
vi.mock("../../server/storage", () => ({ storage: { variables: { getJsonState: mocks.read } } }));
vi.mock("../../server/storage/transaction-context", () => ({ runOutsideTransaction: (fn: () => unknown) => fn() }));
vi.mock("../../server/storage/configuration-revisions", () => ({ readConfigurationSnapshot: (fn: () => unknown) => fn() }));
vi.mock("../../server/services/component-cache", () => ({
  loadComponentCache: mocks.refresh, isComponentEnabledSync: mocks.enabled,
  getEnabledComponentIdsSync: vi.fn(), updateComponentCache: vi.fn(),
}));
vi.mock("../../server/services/component-lifecycle", () => ({}));
vi.mock("../../server/services/component-permissions", () => ({ syncComponentPermissions: vi.fn() }));
vi.mock("../../server/services/access-policy-evaluator", () => ({
  requireAccess: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  clearAccessCache: vi.fn(),
}));
import { registerComponentRoutes } from "../../server/modules/components";
import { refreshComponentStateForApi } from "../../server/middleware/component-state";

let server: Server;
let origin: string;
beforeEach(async () => {
  vi.clearAllMocks();
  mocks.read.mockResolvedValue({ value: { facility: true }, version: "42" });
  mocks.refresh.mockRejectedValue(new Error("Runtime cache refresh failed"));
  const app = express();
  app.use("/api", refreshComponentStateForApi);
  registerComponentRoutes(app, (req, res, next) => {
    if (req.headers["x-test-auth"] !== "yes") { res.status(401).json({ message: "Unauthorized" }); return; }
    next();
  }, _permission => (_req, _res, next) => next());
  app.use((_req, res) => res.json({ reached: true }));
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server has no address");
  origin = `http://127.0.0.1:${address.port}`;
});
afterEach(async () => {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

describe("cache-independent authenticated status route", () => {
  it.each(["/api/components/config", "/api/components/config/?view=status", "/api/COMPONENTS/CONFIG"])(
    "serves %s without calling cache refresh or cache getters", async path => {
      const response = await fetch(origin + path, { headers: { "x-test-auth": "yes" } });
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      const configs = await response.json();
      expect(configs.find((c: any) => c.componentId === "facility")).toMatchObject({
        enabled: true, definition: { id: "facility" },
      });
      expect(mocks.read).toHaveBeenCalledOnce();
      expect(mocks.refresh).not.toHaveBeenCalled();
      expect(mocks.enabled).not.toHaveBeenCalled();
    },
  );

  it("does not exempt authentication", async () => {
    expect((await fetch(origin + "/api/components/config")).status).toBe(401);
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it.each(["failure", "malformed"])("reports %s storage as unavailable, never disabled", async scenario => {
    if (scenario === "failure") mocks.read.mockRejectedValue(new Error("Database unavailable"));
    else mocks.read.mockResolvedValue({ value: [], version: "42" });
    const response = await fetch(origin + "/api/components/config", { headers: { "x-test-auth": "yes" } });
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ message: "Component status is unavailable. Unable to read current settings from storage." });
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("supports read-only HEAD without exempting mutations", async () => {
    const head = await fetch(origin + "/api/components/config", { method: "HEAD", headers: { "x-test-auth": "yes" } });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    expect(mocks.refresh).not.toHaveBeenCalled();
    const mutation = await fetch(origin + "/api/components/config/facility", { method: "PUT" });
    expect(mutation.status).toBe(503);
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it.each([
    "/api/components/config/facility", "/api/components/configuration",
    "/api/components/facility/schema-info", "/api/components/env-vars",
  ])("does not exempt neighboring GET %s", async path => {
    expect((await fetch(origin + path)).status).toBe(503);
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(mocks.read).not.toHaveBeenCalled();
  });
});
