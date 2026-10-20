import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { registerHelpRoutes } from "../../server/modules/helps";
import { getAllSystemHelps } from "../../server/help/system";
import { likePatternMatches } from "../../server/help/path-match";
import { sanitizeHtml } from "../../shared/utils/html";

// No database or real session. This harness exercises the real read handlers
// with test-only auth and a read-only local-help double.
const localHelp = Object.freeze({
  id: "fictional-local-help", paths: ["/workers/%/benefits/scan"],
  summary: "Organization-specific review", details: "<p>Retained local procedure.</p>", data: null,
});
const before = JSON.stringify(localHelp);
const local = {
  getAll: vi.fn(async () => [localHelp]),
  findMatchingForPath: vi.fn(async (path: string) =>
    localHelp.paths.some(pattern => likePatternMatches(pattern, path)) ? [localHelp] : []),
  create: vi.fn(), update: vi.fn(), delete: vi.fn(),
};
let server: http.Server;
let base: string;
beforeAll(async () => {
  const app = express();
  registerHelpRoutes(app,
    (req, res, next) => req.headers["x-test-user"] ? next() : void res.sendStatus(401),
    () => (_req, res) => { res.sendStatus(403); },
    { helps: local } as any,
  );
  server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve, reject) =>
  server.close(error => error ? reject(error) : resolve())));
const signedIn = { "x-test-user": "fixture-user" };
const read = (path: string) => fetch(`${base}${path}`, { headers: signedIn });

describe("backfilled guidance through existing authenticated read handlers", () => {
  it("requires sign-in for listing, lookup, and individual built-ins", async () => {
    for (const path of ["/api/helps", "/api/helps/lookup?path=/config/helps",
      "/api/helps/system:benefits-scan"]) {
      expect((await fetch(`${base}${path}`)).status).toBe(401);
    }
  });
  it("lists every sanitized built-in and retains local content without mutation", async () => {
    const response = await read("/api/helps");
    expect(response.status).toBe(200);
    const entries = await response.json();
    for (const expected of getAllSystemHelps()) {
      expect(entries).toContainEqual(expected);
      if (expected.details) expect(expected.details).toBe(sanitizeHtml(expected.details, "rich-document"));
    }
    expect(entries).toContainEqual({ ...localHelp, source: "config" });
    expect(JSON.stringify(localHelp)).toBe(before);
    expect(local.create).not.toHaveBeenCalled();
    expect(local.update).not.toHaveBeenCalled();
    expect(local.delete).not.toHaveBeenCalled();
  });
  it.each([
    ["/workers/example/benefits/scan", "system:benefits-scan"],
    ["/bao/dc/cases/example", "system:disability-credit-staff"],
    ["/ledger/payment/example/edit", "system:staff-payment-entry"],
    ["/admin/letter-templates/example", "system:letter-template-studio"],
    ["/workers/example/aat", "system:worker-access-tokens"],
    ["/sitespecific/btu/worker-import", "system:btu-worker-import"],
    ["/edls/sheet/example/manage", "system:edls-scheduling"],
    ["/admin/denorm/example", "system:denorm-maintenance"],
    ["/config/helps", "system:help-text-listing"],
  ])("returns inline summary and expanded details for %s", async (path, id) => {
    const response = await read(`/api/helps/lookup?path=${encodeURIComponent(path)}`);
    expect(response.status).toBe(200);
    const matches = await response.json();
    const entry = matches.find((item: { id: string }) => item.id === id);
    expect(entry.summary).toBeTruthy();
    expect(entry.details).toContain("<h3>Purpose</h3>");
    expect(entry.source).toBe("system");
    expect(matches.some((item: { id: string }) => item.id === localHelp.id))
      .toBe(path === "/workers/example/benefits/scan");
  });
});
