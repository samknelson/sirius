import express from "express";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import type { Server } from "node:http";

const fixture = vi.hoisted(() => ({ read: vi.fn(), start: vi.fn(), disabled: "" }));
vi.mock("../../server/modules/components", () => ({
  requireComponent: (id: string) => (_req: any, res: any, next: any) =>
    fixture.disabled === id ? res.status(403).end() : next(),
}));
vi.mock("../../server/services/webclient", () => ({ wcRequest: vi.fn() }));
vi.mock("../../server/plugins/wc-vendors/plugins/sitespecific-t631", () => ({
  T631_ACTIONS: ["sitespecific.t631.worker.list"], T631_PLUGIN_ID: "t631",
}));
vi.mock("../../server/modules/masquerade", () => ({
  getEffectiveUser: async () => ({ dbUser: { id: "effective-actor" } }),
}));
vi.mock("../../server/services/t631-sync-runs", () => ({
  startT631Run: fixture.start, readT631Run: fixture.read,
  publicT631Run: (run: unknown) => run, T631RunRefusal: class extends Error {},
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
  base = `http://127.0.0.1:${(server.address() as any).port}/api/sitespecific/t631/client/sync-workers`;
});
beforeEach(() => {
  fixture.disabled = "";
  fixture.read.mockReset().mockResolvedValue({ id: "exact-run", status: "running" });
  fixture.start.mockReset().mockResolvedValue({ run: { id: "exact-run" }, duplicate: false });
});
afterAll(() => new Promise<void>(r => server.close(() => r())));

it.each(["", "/runs", "/runs/exact-run"])("gates %s by authentication, admin and both components", async path => {
  const request = (auth?: string) => fetch(base + path, {
    method: path ? "GET" : "POST", headers: auth ? { authorization: auth } : {},
  });
  expect((await request()).status).toBe(401);
  expect((await request("staff")).status).toBe(403);
  for (const component of ["edls", "sitespecific.t631.client"]) {
    fixture.disabled = component;
    expect((await request("admin")).status).toBe(403);
  }
  expect(fixture.read).not.toHaveBeenCalled();
  expect(fixture.start).not.toHaveBeenCalled();
});
it("returns a short accepted identifier with effective actor and private no-store", async () => {
  const response = await fetch(base, { method: "POST", headers: { authorization: "admin", "Content-Type": "application/json" }, body: '{"dryRun":false}' });
  expect(response.status).toBe(202);
  expect(await response.json()).toEqual({ runId: "exact-run", duplicate: false });
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(fixture.start).toHaveBeenCalledWith(false, "effective-actor");
});
it("returns the existing identifier on a duplicate without starting again", async () => {
  fixture.start.mockResolvedValue({ run: { id: "active" }, duplicate: true });
  const response = await fetch(base, { method: "POST", headers: { authorization: "admin" } });
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ runId: "active" });
});
it("reads only the named run, marks reads private, and distinguishes unavailable status", async () => {
  const response = await fetch(base + "/runs/exact-run", { headers: { authorization: "admin" } });
  expect(fixture.read).toHaveBeenCalledWith("exact-run");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  fixture.read.mockRejectedValue(new Error("private database error"));
  const failed = await fetch(base + "/runs", { headers: { authorization: "admin" } });
  expect(failed.status).toBe(503);
  expect(await failed.json()).toEqual({ message: "Sync status is temporarily unavailable. This does not mean the sync failed." });
});
