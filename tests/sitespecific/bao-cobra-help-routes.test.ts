import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { registerHelpRoutes } from "../../server/modules/helps";
import { baoCobraHelp } from "../../server/help/system/bao-cobra";

let server: http.Server;
let base: string;
const localHelp = { id: "local", paths: ["/cobra/cases"], summary: "Local procedure", details: "<p>Keep this local guidance.</p>", data: null };
const local = { getAll: vi.fn(async () => [localHelp]), findMatchingForPath: vi.fn(async () => [localHelp]),
  create: vi.fn(), update: vi.fn(), delete: vi.fn() };
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  registerHelpRoutes(app,
    (req, res, next) => req.headers["x-test-user"] ? next() : void res.sendStatus(401),
    () => (_req, res) => { res.sendStatus(403); },
    { helps: local } as any,
  );
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
const signedIn = { "x-test-user": "fixture-user" };
describe("COBRA guidance through the authenticated help framework", () => {
  it("requires authentication and includes built-in and unmodified local help together", async () => {
    expect((await fetch(`${base}/api/helps`)).status).toBe(401);
    const entries = await (await fetch(`${base}/api/helps`, { headers: signedIn })).json();
    expect(entries).toContainEqual(expect.objectContaining({ id: baoCobraHelp.id, source: "system" }));
    expect(entries).toContainEqual({ ...localHelp, source: "config" });
  });
  it("matches COBRA paths, sanitizes details and leaves unrelated paths alone", async () => {
    const path = encodeURIComponent("/workers/fixture/sitespecific/bao/cobra");
    const matches = await (await fetch(`${base}/api/helps/lookup?path=${path}`, { headers: signedIn })).json();
    expect(matches.find((h: any) => h.id === baoCobraHelp.id).details).toContain("<h3>Case status is not monthly coverage</h3>");
    const unrelated = await (await fetch(`${base}/api/helps/lookup?path=/workers/fixture/hours`, { headers: signedIn })).json();
    expect(unrelated.some((h: any) => h.id === baoCobraHelp.id)).toBe(false);
    expect(local.create).not.toHaveBeenCalled();
    expect(local.update).not.toHaveBeenCalled();
    expect(local.delete).not.toHaveBeenCalled();
  });
});
