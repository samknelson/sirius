/**
 * Auth session lifecycle regression coverage (task: keep active Okta
 * sessions alive). Locks in:
 *
 * - The persisted Sirius session is the authoritative login lifetime: an
 *   expired provider access token with no refresh capability does NOT 401.
 * - Successful refresh persists the refreshed user (including a rotated
 *   refresh token) back to the session before the request continues.
 * - Refresh rejection / refresh errors follow one explicit reauth path:
 *   session destroyed, 401 with code "reauth_required".
 * - Session cookies are rolling: active requests re-send the cookie with a
 *   fresh expiry and touch the store, while idle sessions still expire.
 * - StorageSessionStore derives row expiry from the cookie and rolls it
 *   forward on touch.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import session from "express-session";
import type { AddressInfo } from "net";

// The session store (imported by server/auth/index) pulls the full storage
// barrel; replace it with an in-memory sessions API so these tests exercise
// auth logic only.
const fakeSessionRows = new Map<string, { sess: any; expire: Date }>();
vi.mock("../../server/storage", () => ({
  storage: {
    sessions: {
      getSessionData: async (sid: string) => {
        const row = fakeSessionRows.get(sid);
        if (!row || row.expire.getTime() <= Date.now()) return undefined;
        return row.sess;
      },
      upsertSession: async (sid: string, sess: any, expire: Date) => {
        fakeSessionRows.set(sid, { sess, expire });
      },
      deleteSession: async (sid: string) => {
        fakeSessionRows.delete(sid);
      },
      touchSession: async (sid: string, expire: Date) => {
        const row = fakeSessionRows.get(sid);
        if (row) row.expire = expire;
      },
    },
  },
}));

import {
  isAuthenticated,
  providerRegistry,
  buildSessionOptions,
} from "../../server/auth/index";
import { StorageSessionStore } from "../../server/auth/session-store";

const nowSec = () => Math.floor(Date.now() / 1000);

function makeReqRes(user: any) {
  const sessionObj: any = {
    passport: user ? { user } : undefined,
    saveCalls: 0,
    save(cb: (err?: unknown) => void) {
      this.saveCalls++;
      cb();
    },
    destroyed: false,
    destroy(cb: (err?: unknown) => void) {
      this.destroyed = true;
      cb();
    },
  };
  const req: any = {
    user,
    isAuthenticated: () => Boolean(user),
    session: sessionObj,
    loggedOut: false,
    logout(cb: () => void) {
      this.loggedOut = true;
      cb();
    },
  };
  const res: any = {
    statusCode: 0,
    body: undefined as any,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: any) {
      this.body = payload;
      return this;
    },
  };
  return { req, res, sessionObj };
}

function runMiddleware(req: any, res: any): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (nextCalled: boolean) => {
      if (!settled) {
        settled = true;
        resolve(nextCalled);
      }
    };
    const origJson = res.json.bind(res);
    res.json = (payload: any) => {
      const r = origJson(payload);
      finish(false);
      return r;
    };
    Promise.resolve(isAuthenticated(req, res, () => finish(true))).catch(() =>
      finish(false),
    );
  });
}

describe("isAuthenticated lifecycle", () => {
  const registeredTypes: string[] = [];
  const registerProvider = (provider: any) => {
    providerRegistry.register(provider);
    registeredTypes.push(provider.type);
  };

  afterEach(() => {
    // providerRegistry has no unregister; overwrite with a stub that has no
    // refreshToken so later tests are not affected.
    for (const type of registeredTypes.splice(0)) {
      providerRegistry.register({ type } as any);
    }
  });

  it("401s when there is no local session", async () => {
    const { req, res } = makeReqRes(undefined);
    const nextCalled = await runMiddleware(req, res);
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(401);
    expect(res.body.message).toBe("Unauthorized");
  });

  it("passes through when the access token is not expired", async () => {
    const { req, res } = makeReqRes({
      providerType: "okta",
      expires_at: nowSec() + 3600,
    });
    expect(await runMiddleware(req, res)).toBe(true);
  });

  it("keeps the session authoritative when the token expired and no refresh token was issued", async () => {
    const { req, res } = makeReqRes({
      providerType: "okta",
      expires_at: nowSec() - 60,
      // no refresh_token
    });
    expect(await runMiddleware(req, res)).toBe(true);
    expect(res.statusCode).toBe(0);
  });

  it("keeps the session authoritative when the provider has no refresh support", async () => {
    registerProvider({ type: "okta" }); // no refreshToken method
    const { req, res } = makeReqRes({
      providerType: "okta",
      refresh_token: "rt-1",
      expires_at: nowSec() - 60,
    });
    expect(await runMiddleware(req, res)).toBe(true);
  });

  it("refreshes, applies rotated credentials, and persists them to the session", async () => {
    const rotated = {
      access_token: "at-2",
      refresh_token: "rt-2",
      expires_at: nowSec() + 3600,
      claims: { sub: "u1", exp: nowSec() + 3600 },
    };
    registerProvider({
      type: "okta",
      refreshToken: vi.fn(async (u: any) => ({ ...u, ...rotated })),
    });
    const user = {
      providerType: "okta",
      access_token: "at-1",
      refresh_token: "rt-1",
      expires_at: nowSec() - 60,
      claims: { sub: "u1" },
    };
    const { req, res, sessionObj } = makeReqRes(user);
    expect(await runMiddleware(req, res)).toBe(true);
    // rotated token in effect for later requests
    expect(req.user.refresh_token).toBe("rt-2");
    expect(req.user.access_token).toBe("at-2");
    // persisted back to the session before the request continued
    expect(sessionObj.passport.user).toBe(req.user);
    expect(sessionObj.saveCalls).toBe(1);
  });

  it("preserves the old refresh token when the provider does not rotate it", async () => {
    registerProvider({
      type: "okta",
      // Mirrors the okta provider contract: refresh_token falls back to the
      // existing one when Okta omits it from the response.
      refreshToken: vi.fn(async (u: any) => {
        // Mirrors the okta provider contract: a response without a rotated
        // refresh_token falls back to the existing one.
        const responseRefreshToken: string | undefined = undefined;
        return {
          ...u,
          access_token: "at-2",
          refresh_token: responseRefreshToken || u.refresh_token,
          expires_at: nowSec() + 3600,
        };
      }),
    });
    const { req, res } = makeReqRes({
      providerType: "okta",
      refresh_token: "rt-keep",
      expires_at: nowSec() - 60,
    });
    expect(await runMiddleware(req, res)).toBe(true);
    expect(req.user.refresh_token).toBe("rt-keep");
  });

  it("destroys the session and 401s with reauth_required when the provider rejects the refresh", async () => {
    registerProvider({
      type: "okta",
      refreshToken: vi.fn(async () => null),
    });
    const { req, res, sessionObj } = makeReqRes({
      providerType: "okta",
      refresh_token: "rt-revoked",
      expires_at: nowSec() - 60,
    });
    expect(await runMiddleware(req, res)).toBe(false);
    expect(res.statusCode).toBe(401);
    expect(res.body.code).toBe("reauth_required");
    expect(req.loggedOut).toBe(true);
    expect(sessionObj.destroyed).toBe(true);
  });

  it("preserves the active session when the refresh attempt fails transiently", async () => {
    registerProvider({
      type: "okta",
      refreshToken: vi.fn(async () => {
        throw new Error("network down");
      }),
    });
    const { req, res, sessionObj } = makeReqRes({
      providerType: "okta",
      refresh_token: "rt-1",
      expires_at: nowSec() - 60,
    });
    // Transient failure says nothing about revocation: the local session
    // stays authoritative and the request proceeds.
    expect(await runMiddleware(req, res)).toBe(true);
    expect(res.statusCode).toBe(0);
    expect(req.loggedOut).toBe(false);
    expect(sessionObj.destroyed).toBe(false);
    // Credentials untouched; refresh will be retried on a later request.
    expect(req.user.refresh_token).toBe("rt-1");
  });

  it("fails the request explicitly (retryable 503) when refreshed credentials cannot be persisted", async () => {
    registerProvider({
      type: "okta",
      refreshToken: vi.fn(async (u: any) => ({
        ...u,
        access_token: "at-2",
        refresh_token: "rt-2", // rotated — must not be served unpersisted
        expires_at: nowSec() + 3600,
      })),
    });
    const { req, res, sessionObj } = makeReqRes({
      providerType: "okta",
      refresh_token: "rt-1",
      expires_at: nowSec() - 60,
    });
    sessionObj.save = function (cb: (err?: unknown) => void) {
      this.saveCalls++;
      cb(new Error("store write failed"));
    };
    expect(await runMiddleware(req, res)).toBe(false);
    expect(res.statusCode).toBe(503);
    // one retry attempted
    expect(sessionObj.saveCalls).toBe(2);
    // not a logout: the session survives for a retried request
    expect(req.loggedOut).toBe(false);
    expect(sessionObj.destroyed).toBe(false);
  });

  it("retries a transiently failed session save and continues on success", async () => {
    registerProvider({
      type: "okta",
      refreshToken: vi.fn(async (u: any) => ({
        ...u,
        refresh_token: "rt-2",
        expires_at: nowSec() + 3600,
      })),
    });
    const { req, res, sessionObj } = makeReqRes({
      providerType: "okta",
      refresh_token: "rt-1",
      expires_at: nowSec() - 60,
    });
    let first = true;
    sessionObj.save = function (cb: (err?: unknown) => void) {
      this.saveCalls++;
      if (first) {
        first = false;
        return cb(new Error("transient"));
      }
      cb();
    };
    expect(await runMiddleware(req, res)).toBe(true);
    expect(sessionObj.saveCalls).toBe(2);
    expect(req.user.refresh_token).toBe("rt-2");
  });
});

describe("session options", () => {
  it("uses rolling cookies with the configured TTL", () => {
    const opts = buildSessionOptions({
      secret: "s".repeat(32),
      sessionTtl: 12345,
      isProduction: true,
      store: new session.MemoryStore(),
    });
    expect(opts.rolling).toBe(true);
    expect(opts.resave).toBe(false);
    expect(opts.saveUninitialized).toBe(false);
    expect(opts.cookie?.maxAge).toBe(12345);
    expect(opts.cookie?.httpOnly).toBe(true);
    expect(opts.cookie?.secure).toBe(true);
  });
});

describe("StorageSessionStore expiry semantics", () => {
  beforeEach(() => fakeSessionRows.clear());

  it("derives the row expiry from the cookie and rolls it forward on touch", async () => {
    const store = new StorageSessionStore({ ttlMs: 60_000 });
    const early = new Date(Date.now() + 10_000);
    const sess: any = { cookie: { expires: early.toISOString() }, foo: 1 };
    await new Promise<void>((r) => store.set("sid1", sess, () => r()));
    expect(fakeSessionRows.get("sid1")!.expire.getTime()).toBe(early.getTime());

    const later = new Date(Date.now() + 50_000);
    sess.cookie.expires = later.toISOString();
    await new Promise<void>((r) => store.touch("sid1", sess, () => r()));
    expect(fakeSessionRows.get("sid1")!.expire.getTime()).toBe(later.getTime());
  });

  it("falls back to now + ttl when the cookie has no expiry, and get skips expired rows", async () => {
    const store = new StorageSessionStore({ ttlMs: 60_000 });
    const before = Date.now();
    await new Promise<void>((r) => store.set("sid2", { cookie: {} } as any, () => r()));
    const expire = fakeSessionRows.get("sid2")!.expire.getTime();
    expect(expire).toBeGreaterThanOrEqual(before + 60_000);

    // Idle expiry: once the row's expire passes, get returns nothing.
    fakeSessionRows.get("sid2")!.expire = new Date(Date.now() - 1);
    const got = await new Promise((resolve) =>
      store.get("sid2", (_e, s) => resolve(s)),
    );
    expect(got).toBeNull();
  });
});

describe("rolling cookie end-to-end", () => {
  it("re-sends the cookie with a later expiry on activity and expires idle sessions", async () => {
    fakeSessionRows.clear();
    const ttl = 60_000;
    const store = new StorageSessionStore({ ttlMs: ttl });
    const app = express();
    app.use(
      session(
        buildSessionOptions({
          secret: "t".repeat(32),
          sessionTtl: ttl,
          isProduction: false,
          store,
        }),
      ),
    );
    app.get("/whoami", (req: any, res) => {
      if (req.session.userId) return res.json({ userId: req.session.userId });
      return res.status(401).json({ message: "no session" });
    });
    app.post("/login", (req: any, res) => {
      req.session.userId = "u1";
      res.json({ ok: true });
    });

    const server = app.listen(0);
    try {
      const port = (server.address() as AddressInfo).port;
      const base = `http://127.0.0.1:${port}`;

      const login = await fetch(`${base}/login`, { method: "POST" });
      const setCookie1 = login.headers.get("set-cookie")!;
      expect(setCookie1).toBeTruthy();
      const cookie = setCookie1.split(";")[0];
      const expires1 = new Date(/Expires=([^;]+)/i.exec(setCookie1)![1]);

      const sid = Array.from(fakeSessionRows.keys())[0];
      const storeExpire1 = fakeSessionRows.get(sid)!.expire.getTime();

      // Active request a bit later: rolling cookie re-sent with later expiry
      // AND the persisted row's expiry advances (store touch).
      await new Promise((r) => setTimeout(r, 1100));
      const active = await fetch(`${base}/whoami`, { headers: { cookie } });
      expect(active.status).toBe(200);
      const setCookie2 = active.headers.get("set-cookie");
      expect(setCookie2).toBeTruthy();
      const expires2 = new Date(/Expires=([^;]+)/i.exec(setCookie2!)![1]);
      expect(expires2.getTime()).toBeGreaterThan(expires1.getTime());
      expect(fakeSessionRows.get(sid)!.expire.getTime()).toBeGreaterThan(
        storeExpire1,
      );

      // Idle expiry: once the persisted row lapses, the session is gone.
      fakeSessionRows.get(sid)!.expire = new Date(Date.now() - 1);
      const idle = await fetch(`${base}/whoami`, { headers: { cookie } });
      expect(idle.status).toBe(401);
    } finally {
      server.close();
    }
  }, 20_000);
});
