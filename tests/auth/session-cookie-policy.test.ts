import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setEnvironmentVariableOverride } from "../../server/config/env-registry";

vi.mock("../../server/auth/config", () => ({
  loadAuthConfig: () => ({ sessionSecret: "test-only-cookie-signing-secret", sessionTtl: 60_000, providers: [] }),
}));
vi.mock("../../server/auth/session-store", async () => {
  const { MemoryStore } = await import("express-session");
  return { StorageSessionStore: MemoryStore };
});
vi.mock("../../server/auth/provider-loader", () => ({ loadProvider: vi.fn() }));
vi.mock("../../server/logger", () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock("../../server/middleware/request-context", () => ({ captureRequestIpContext: vi.fn() }));
vi.mock("../../server/auth/sign-in-events", () => ({ observeSuccessfulSignIns: vi.fn() }));
vi.mock("../../server/auth/device-cookie", () => ({ createDeviceCookieMiddleware: vi.fn() }));
import { getSession } from "../../server/auth";

afterEach(() => setEnvironmentVariableOverride("NODE_ENV", null));

describe("session cookie SameSite policy", () => {
  it.each([false, true])("uses Lax and HttpOnly, with Secure only in production=%s", async production => {
    setEnvironmentVariableOverride("NODE_ENV", () => production ? "production" : "development");
    const app = express();
    app.set("trust proxy", 1);
    app.use(getSession());
    app.get("/session", (req, res) => {
      (req.session as any).test = true;
      res.json({ lifetime: req.session.cookie.originalMaxAge });
    });
    const server = http.createServer(app);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
      const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/session`;
      const response = await fetch(url, { headers: { "X-Forwarded-Proto": "https" } });
      const cookie = response.headers.get("set-cookie")!;
      expect(cookie).toContain("HttpOnly");
      expect(cookie).toContain("SameSite=Lax");
      expect(cookie.includes("; Secure")).toBe(production);
      expect((await response.json()).lifetime).toBe(60_000);
    } finally {
      await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
    }
  });

  it("upgrades a restored legacy session's cookie without rotating its ID", async () => {
    setEnvironmentVariableOverride("NODE_ENV", () => "development");
    const app = express();
    const restore = getSession();
    // The second restoration sees a session saved with the old cookie policy.
    app.use(restore);
    app.get("/legacy", (req, res) => {
      (req.session as any).value = "legacy";
      req.session.cookie.sameSite = undefined;
      res.json({ id: req.sessionID });
    });
    app.get("/current", (req, res) => {
      (req.session as any).value = "current"; // Reissue the cookie.
      res.json({ id: req.sessionID, sameSite: req.session.cookie.sameSite });
    });
    const server = http.createServer(app);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const first = await fetch(base + "/legacy");
      const id = (await first.json()).id;
      const cookie = first.headers.get("set-cookie")!.split(";")[0];
      const restored = await fetch(base + "/current", { headers: { Cookie: cookie } });
      expect(await restored.json()).toEqual({ id, sameSite: "lax" });
      expect(restored.headers.get("set-cookie")).toContain("SameSite=Lax");
    } finally {
      await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
    }
  });
});
