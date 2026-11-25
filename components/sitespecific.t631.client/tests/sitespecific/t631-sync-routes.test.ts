import express from "express";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import type { Server } from "node:http";
import { readFileSync } from "node:fs";

const fixture = vi.hoisted(() => ({ request: vi.fn(), disabled: "" }));
vi.mock("../../../../server/modules/components", () => ({
  requireComponent: (id: string) => (_req: any, res: any, next: any) =>
    fixture.disabled === id ? res.status(403).end() : next(),
}));
vi.mock("../../../../server/services/webclient", () => ({ wcRequest: fixture.request }));
vi.mock("../../server/plugins/wc-vendors/plugins/sitespecific-t631", () => ({
  T631_ACTIONS: ["sitespecific.t631.worker.list"], T631_PLUGIN_ID: "sitespecific-t631",
}));
import { registerT631ClientFetchRoutes } from "../../server/modules/sitespecific/t631/client/fetch";

let server: Server, base: string;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  registerT631ClientFetchRoutes(app,
    (req, res, next) => { if (req.headers.authorization) next(); else res.status(401).end(); },
    permission => (req, res, next) => {
      if (permission === "admin" && req.headers.authorization === "admin") next();
      else res.status(403).end();
    });
  server = app.listen(0);
  await new Promise<void>(r => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as any).port}/api/sitespecific/t631/client`;
});
beforeEach(() => {
  fixture.disabled = "";
  fixture.request.mockReset().mockResolvedValue({ outcome: "success", value: { success: true } });
});
afterAll(() => new Promise<void>(r => server.close(() => r())));

it.each(["", "/runs", "/runs/exact-run"])("removes standalone worker-sync endpoint %s", async path => {
  const response = await fetch(`${base}/sync-workers${path}`, {
    method: path ? "GET" : "POST", headers: { authorization: "admin" },
  });
  expect(response.status).toBe(404);
  expect(response.headers.get("location")).toBeNull();
  expect(fixture.request).not.toHaveBeenCalled();
});
it("preserves guarded raw vendor diagnostics without importing workers", async () => {
  const request = (auth?: string) => fetch(`${base}/fetch`, {
    method: "POST", headers: { "Content-Type": "application/json", ...(auth ? { authorization: auth } : {}) },
    body: JSON.stringify({ action: "sitespecific.t631.worker.list" }),
  });
  expect((await request()).status).toBe(401);
  expect((await request("staff")).status).toBe(403);
  for (const component of ["edls", "sitespecific.t631.client"]) {
    fixture.disabled = component;
    expect((await request("admin")).status).toBe(403);
  }
  expect(fixture.request).not.toHaveBeenCalled();
  fixture.disabled = "";
  const response = await request("admin");
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ success: true });
  expect(fixture.request).toHaveBeenCalledOnce();
});
it("removes the old page registration and navigation without replacement links", () => {
  for (const path of ["client/src/App.tsx", "client/src/config/navigation-registry.ts", "client/src/pages/admin/wc-overview.tsx"]) {
    expect(readFileSync(path, "utf8")).not.toContain("/config/edls/t631-fetch");
  }
});
