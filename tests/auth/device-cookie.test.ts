import { beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Request, type Response } from "express";
import session from "express-session";
import { request as httpRequest } from "node:http";
import { createHmac } from "node:crypto";
import {
  DEVICE_COOKIE_LIFETIME_SECONDS as lifetime, DEVICE_COOKIE_RENEW_SECONDS as renewal,
  readDeviceCookie, resolveDeviceCookie, signDeviceCookie, verifyDeviceCookie,
} from "../../server/auth/device-cookie-token";

const fakes = vi.hoisted(() => ({
  get: vi.fn(), create: vi.fn(), hook: vi.fn(), warn: vi.fn(),
  row: undefined as undefined | { name: string; value: unknown },
  override: undefined as string | undefined,
}));
vi.mock("../../server/storage", () => ({
  storage: { variables: { getByName: fakes.get, create: fakes.create } },
}));
vi.mock("../../server/modules/system/variable-registry", () => ({ runVariableOnWrite: fakes.hook }));
vi.mock("../../server/logger", () => ({ logger: { warn: fakes.warn, error: vi.fn() } }));
vi.mock("../../server/modules/masquerade", () => ({
  getEffectiveUser: async () => ({
    dbUser: { id: "effective-user", email: "effective@example.invalid" },
    originalUser: { id: "original-user", email: "original@example.invalid" },
  }),
}));

import { createDeviceCookieKeyResolver } from "../../server/auth/device-cookie-key";
import { createDeviceCookieMiddleware } from "../../server/auth/device-cookie";
import {
  captureRequestContext, captureRequestIpContext, getRequestContext,
} from "../../server/middleware/request-context";
import {
  getEnvironmentVariable, getRawProcessEnv, listEnvironmentVariables,
  setEnvironmentVariableOverrideSource,
} from "../../server/config/env-registry";
import {
  captureRestartBaseline, listPendingRestartVariables,
} from "../../server/services/env-restart-pending";

const key = "synthetic-key-for-device-cookie-tests-only";
const uuid = "01234567-89ab-4cde-8fab-0123456789ab";
const now = 1_800_000_000;
const token = signDeviceCookie(uuid, now, key);

beforeEach(() => {
  vi.clearAllMocks();
  delete getRawProcessEnv().DEVICE_COOKIE_HMAC;
  getRawProcessEnv().NODE_ENV = "development";
  fakes.row = undefined;
  fakes.override = undefined;
  setEnvironmentVariableOverrideSource(name => name === "DEVICE_COOKIE_HMAC" ? fakes.override : undefined);
  fakes.get.mockImplementation(async () => fakes.row);
  fakes.create.mockImplementation(async row => { fakes.row = row; return row; });
  fakes.hook.mockImplementation(async () => {
    fakes.override = typeof fakes.row?.value === "string" ? fakes.row.value : undefined;
  });
});

describe("signed browser-profile contract", () => {
  it("issues canonical v4 UUIDs, purpose-separated MACs, and preserves verified UUIDs", () => {
    const issued = resolveDeviceCookie(undefined, key, now);
    expect(issued.uuid).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
    expect(verifyDeviceCookie(issued.cookie, key, now)).toEqual({ uuid: issued.uuid, timestamp: now });
    expect(resolveDeviceCookie(token, key, now)).toEqual({ uuid });
    expect(verifyDeviceCookie(token, key + "-rotated", now)).toBeUndefined();
    expect(token.split(".")[2]).toBe(createHmac("sha256", key)
      .update(`device_id:v1:${uuid}.${now}`).digest("base64url"));
    const unprefixed = createHmac("sha256", key).update(`${uuid}.${now}`).digest("base64url");
    expect(verifyDeviceCookie(`${uuid}.${now}.${unprefixed}`, key, now)).toBeUndefined();
  });
  it("renews only after ten days and expires only beyond 400 days", () => {
    expect(resolveDeviceCookie(token, key, now + renewal)).toEqual({ uuid });
    const renewed = resolveDeviceCookie(token, key, now + renewal + 1);
    expect(renewed.uuid).toBe(uuid);
    expect(verifyDeviceCookie(renewed.cookie, key, now + renewal + 1))
      .toEqual({ uuid, timestamp: now + renewal + 1 });
    expect(verifyDeviceCookie(token, key, now + lifetime)).toBeDefined();
    expect(verifyDeviceCookie(token, key, now + lifetime + 1)).toBeUndefined();
    expect(resolveDeviceCookie(token, key, now + lifetime + 1).uuid).not.toBe(uuid);
  });
  it("allows five minutes of future clock skew, not a second more", () => {
    expect(verifyDeviceCookie(signDeviceCookie(uuid, now + 300, key), key, now)).toBeDefined();
    expect(verifyDeviceCookie(signDeviceCookie(uuid, now + 301, key), key, now)).toBeUndefined();
  });
  it.each([
    "", "too.short", token + ".extra", token + "=", token.toUpperCase(),
    token.replace(".1800000000.", ".01800000000."),
    token.replace(".1800000000.", ".1.8e9."),
    token.replace(".1800000000.", ".-1."),
    signDeviceCookie(uuid, Number.MAX_SAFE_INTEGER + 1, key),
    signDeviceCookie(uuid.replace("-4cde-", "-1cde-"), now, key),
    token.slice(0, -1) + "!", "a".repeat(1000),
    // Last base64 character has unused bits. A noncanonical spelling is invalid.
    token.slice(0, -1) + "B",
  ])("rejects malformed or altered input without adopting its UUID: %s", value => {
    expect(verifyDeviceCookie(value, key, now)).toBeUndefined();
    expect(resolveDeviceCookie(value, key, now).uuid).not.toBe(uuid);
  });
  it("never chooses between duplicate device cookies or decodes quoted/escaped tokens", () => {
    expect(readDeviceCookie(`other=x; device_id=${token}; more=y`)).toBe(token);
    for (const header of [
      `device_id=${token}; device_id=${token}`, `device_id; device_id=${token}`,
      `device_id=${token}; device_id=bad`,
    ]) expect(readDeviceCookie(header)).toBeUndefined();
    expect(verifyDeviceCookie(readDeviceCookie(`device_id="${token}"`), key, now)).toBeUndefined();
  });
});

describe("lazy persisted key", () => {
  it.each(["", "__UNSET__"])("released env (%s) generates once through existing operations and refreshes", async released => {
    getRawProcessEnv().DEVICE_COOKIE_HMAC = released;
    captureRestartBaseline();
    const resolve = createDeviceCookieKeyResolver();
    const keys = await Promise.all([resolve(), resolve(), resolve()]);
    expect(new Set(keys).size).toBe(1);
    expect(Buffer.from(keys[0], "base64url").length).toBe(32);
    expect(fakes.get).toHaveBeenCalledExactlyOnceWith("ENV_DEVICE_COOKIE_HMAC");
    expect(fakes.create).toHaveBeenCalledExactlyOnceWith({ name: "ENV_DEVICE_COOKIE_HMAC", value: keys[0] });
    expect(fakes.hook).toHaveBeenCalledExactlyOnceWith("ENV_DEVICE_COOKIE_HMAC");
    expect(getEnvironmentVariable("DEVICE_COOKIE_HMAC")).toBe(keys[0]);
    expect(listPendingRestartVariables().some(v => v.name === "DEVICE_COOKIE_HMAC")).toBe(false);
    fakes.override = key;
    expect(await resolve()).toBe(keys[0]);
    expect(fakes.get).toHaveBeenCalledOnce();
    expect(listPendingRestartVariables().some(v => v.name === "DEVICE_COOKIE_HMAC")).toBe(true);
    expect(await createDeviceCookieKeyResolver()()).toBe(key);
  });
  it("explicit env wins, cached override survives edits/deletion until restart, and declaration is secret", async () => {
    getRawProcessEnv().DEVICE_COOKIE_HMAC = key;
    fakes.override = key + "-stored";
    expect(await createDeviceCookieKeyResolver()()).toBe(key);
    expect(fakes.get).not.toHaveBeenCalled();
    delete getRawProcessEnv().DEVICE_COOKIE_HMAC;
    const resolve = createDeviceCookieKeyResolver();
    expect(await resolve()).toBe(key + "-stored");
    fakes.override = undefined;
    expect(await resolve()).toBe(key + "-stored");
    expect(fakes.get).not.toHaveBeenCalled();
    expect(listEnvironmentVariables().find(v => v.name === "DEVICE_COOKIE_HMAC"))
      .toMatchObject({ secret: true, changeTakesEffect: "restart", overridable: true });
  });
  it("rereads an existing row when the override view is absent", async () => {
    fakes.row = { name: "ENV_DEVICE_COOKIE_HMAC", value: key };
    expect(await createDeviceCookieKeyResolver()()).toBe(key);
    expect(fakes.create).not.toHaveBeenCalled();
    expect(fakes.hook).toHaveBeenCalledOnce();
  });
  it.each(["short", " ".repeat(40)])("does not overwrite invalid configured secrets", async invalid => {
    getRawProcessEnv().DEVICE_COOKIE_HMAC = invalid;
    await expect(createDeviceCookieKeyResolver()()).rejects.toThrow("at least 32");
    expect(fakes.get).not.toHaveBeenCalled();
    delete getRawProcessEnv().DEVICE_COOKIE_HMAC;
    fakes.row = { name: "ENV_DEVICE_COOKIE_HMAC", value: invalid };
    await expect(createDeviceCookieKeyResolver()()).rejects.toThrow("at least 32");
    expect(fakes.create).not.toHaveBeenCalled();
  });
  it("rereads on an existing unique-name conflict without coordination machinery", async () => {
    fakes.create.mockImplementationOnce(async () => {
      fakes.row = { name: "ENV_DEVICE_COOKIE_HMAC", value: key };
      throw Object.assign(new Error("duplicate"), { code: "23505" });
    });
    expect(await createDeviceCookieKeyResolver()()).toBe(key);
    expect(fakes.get).toHaveBeenCalledTimes(2);
  });
  it("persistence and refresh failures retry without caching an unpersisted key", async () => {
    const resolve = createDeviceCookieKeyResolver();
    fakes.create.mockRejectedValueOnce(new Error("read-only connection"));
    await expect(resolve()).rejects.toThrow("read-only");
    fakes.hook.mockRejectedValueOnce(new Error("refresh failed"));
    await expect(resolve()).rejects.toThrow("refresh failed");
    const persisted = fakes.row?.value;
    expect(await resolve()).toBe(persisted);
    expect(fakes.create).toHaveBeenCalledTimes(2);
  });
});

describe("browser middleware boundary", () => {
  function req(path = "/api/auth/providers", cookie?: string): Request {
    return { path, headers: { cookie, "user-agent": "Browser/1" },
      socket: { remoteAddress: "192.0.2.1" }, secure: false } as Request;
  }
  it("exposes new UUID before session loading and keeps it through effective-user capture with IP/UA", async () => {
    const request = req();
    request.user = { claims: { sub: "subject" } } as Express.User;
    const cookie = vi.fn();
    await new Promise<void>((resolve, reject) => captureRequestIpContext(request, {} as Response, () => {
      Promise.resolve(createDeviceCookieMiddleware(async () => key, () => now * 1000)(
        request, { cookie } as unknown as Response, () => {
          const initial = getRequestContext();
          expect(initial).toMatchObject({ ipAddress: "192.0.2.1", userAgent: "Browser/1" });
          expect(initial?.deviceId).toMatch(/^[a-f0-9-]{36}$/);
          void captureRequestContext(request, {} as Response, () => {
            expect(getRequestContext()).toMatchObject({
              ...initial, userId: "effective-user", originalUserId: "original-user",
            });
            expect(request.session).toBeUndefined();
            resolve();
          }).catch(reject);
        },
      )).catch(reject);
    }));
    expect(cookie).toHaveBeenCalledOnce();
    expect(cookie.mock.calls[0][2]).toMatchObject({
      path: "/", httpOnly: true, sameSite: "lax", secure: false,
      maxAge: lifetime * 1000, expires: new Date((now + lifetime) * 1000),
    });
    expect(cookie.mock.calls[0][2]).not.toHaveProperty("domain");
  });
  it.each(["/api/ws", "/api/ws/example", "/ws"])("excludes non-browser transport %s", async path => {
    const getKey = vi.fn();
    const cookie = vi.fn();
    const next = vi.fn();
    await createDeviceCookieMiddleware(getKey)(req(path), { cookie } as unknown as Response, next);
    expect(getKey).not.toHaveBeenCalled();
    expect(cookie).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });
  it("does not issue a cookie for WebSocket upgrades on other paths", async () => {
    const request = req("/");
    request.headers.upgrade = "websocket";
    const getKey = vi.fn();
    await createDeviceCookieMiddleware(getKey)(request, {} as Response, () => {});
    expect(getKey).not.toHaveBeenCalled();
  });
  it("requires secure cookies in production and leaves intervening requests untouched", async () => {
    getRawProcessEnv().NODE_ENV = "production";
    const cookie = vi.fn();
    await createDeviceCookieMiddleware(async () => key, () => now * 1000)(
      req(), { cookie } as unknown as Response, () => {});
    expect(cookie.mock.calls[0][2].secure).toBe(true);
    cookie.mockClear();
    await createDeviceCookieMiddleware(async () => key, () => now * 1000)(
      req("/", `device_id=${token}`), { cookie } as unknown as Response, () => {
        expect(getRequestContext()?.deviceId).toBe(uuid);
      });
    expect(cookie).not.toHaveBeenCalled();
  });
  it("unavailable initialization does not block authentication or supply unverified context", async () => {
    const cookie = vi.fn();
    const next = vi.fn(() => { expect(getRequestContext()?.deviceId).toBeUndefined(); });
    await createDeviceCookieMiddleware(async () => { throw new Error("read-only"); })(
      req("/", `device_id=${token}`), { cookie } as unknown as Response, next);
    expect(next).toHaveBeenCalledOnce();
    expect(cookie).not.toHaveBeenCalled();
  });
  it("issues only device_id anonymously and keeps it across session creation, regeneration and destruction", async () => {
    const app = express();
    const store = new session.MemoryStore();
    app.use(captureRequestIpContext);
    app.use(createDeviceCookieMiddleware(async () => key));
    app.use(session({ secret: key + "-session", store, saveUninitialized: false, resave: false }));
    app.get("/", (_req, res) => res.sendStatus(204));
    app.get("/session/open", (req, res) => {
      Object.assign(req.session, { syntheticAccount: "account-a" });
      res.sendStatus(204);
    });
    app.get("/session/regenerate", (req, res, next) => {
      req.session.regenerate(error => {
        if (error) return next(error);
        Object.assign(req.session, { syntheticAccount: "account-b" });
        res.sendStatus(204);
      });
    });
    app.get("/session/destroy", (req, res, next) => {
      req.session.destroy(error => error ? next(error) : res.sendStatus(204));
    });
    const server = app.listen(0);
    try {
      const address = server.address() as { port: number };
      const visit = (path: string, cookie?: string) => new Promise<string[] | undefined>((resolve, reject) => {
        httpRequest({ port: address.port, path, headers: cookie ? { cookie } : {} }, res => {
          res.resume(); res.on("end", () => resolve(res.headers["set-cookie"]));
        }).on("error", reject).end();
      });
      const cookies = await visit("/");
      expect(cookies).toHaveLength(1);
      expect(cookies?.[0]).toMatch(/^device_id=/);
      expect(cookies?.[0]).toContain("HttpOnly");
      expect(cookies?.[0]).toContain("SameSite=Lax");
      expect(cookies?.[0]).toContain("Max-Age=34560000");
      expect(await new Promise(resolve => store.length((_err, count) => resolve(count)))).toBe(0);
      const device = cookies![0].split(";")[0];
      let browserCookies = device;
      for (const path of ["/session/open", "/session/regenerate", "/session/destroy", "/"]) {
        const changes = await visit(path, browserCookies);
        expect(changes?.some(c => c.startsWith("device_id=")) ?? false).toBe(false);
        const sessionCookie = changes?.find(c => c.startsWith("connect.sid="))?.split(";")[0];
        if (sessionCookie) browserCookies = `${device}; ${sessionCookie}`;
        if (path === "/session/open" || path === "/session/regenerate") {
          expect(sessionCookie).toBeDefined();
          expect(await new Promise(resolve => store.length((_err, count) => resolve(count)))).toBe(1);
        }
      }
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
});
