import express from "express";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  users: new Map<string, any>(),
  sessions: new Map<string, any>(),
  getUser: vi.fn(),
  identity: vi.fn(),
  work: vi.fn(),
}));
vi.mock("../../server/storage", () => ({
  storage: {
    users: { getUser: state.getUser },
    authIdentities: { getByProviderAndExternalId: state.identity },
    variables: { getByName: async () => undefined },
    sessions: {
      getSessionData: async (sid: string) => structuredClone(state.sessions.get(sid)),
      upsertSession: async (sid: string, sess: any) => { state.sessions.set(sid, structuredClone(sess)); },
      deleteSession: async (sid: string) => { state.sessions.delete(sid); },
      touchSession: vi.fn(),
    },
  },
}));
vi.mock("../../server/storage/transaction-context", () => ({
  runOutsideTransaction: (fn: () => unknown) => fn(),
}));
vi.mock("../../server/logger", () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
  storageLogger: { info: vi.fn() },
}));
vi.mock("../../server/auth/config", () => ({
  loadAuthConfig: () => ({
    sessionSecret: "account-authority-test-secret",
    sessionTtl: 60_000,
    providers: [{ type: "local", enabled: true, isDefault: true }],
  }),
  getProviderConfig: vi.fn(),
}));
vi.mock("../../server/auth/device-cookie", () => ({
  createDeviceCookieMiddleware: () => (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../../server/middleware/request-context", () => ({
  captureRequestIpContext: (_req: any, _res: any, next: any) => next(),
  getRequestContext: () => undefined,
}));
vi.mock("../../server/auth/sign-in-events", () => ({
  observeSuccessfulSignIns: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../../server/auth/provider-loader", () => ({
  loadProvider: async () => ({
    type: "local",
    setup: async (app: express.Express) => {
      app.post("/fixture/sign-in", (req, res, next) => {
        const user = {
          providerType: "local", claims: { sub: "external-owner" },
          dbUser: structuredClone(state.users.get("owner")),
        };
        req.login(user as any, error => error ? next(error) : res.json({ ok: true }));
      });
    },
    getLoginHandler: () => (_req: any, res: any) => res.sendStatus(200),
    getCallbackHandler: () => (_req: any, res: any) => res.sendStatus(200),
    getLogoutHandler: () => (_req: any, res: any) => res.sendStatus(200),
  }),
}));

import { setupAuth, isAuthenticated } from "../../server/auth";
import { resolveDbUser } from "../../server/auth/helpers";
import { currentSessionAccounts, withRequestAccounts } from "../../server/auth/account-authority";
import { buildContext, initAccessControl } from "../../server/services/access-policy-evaluator";
import { getEffectiveUser } from "../../server/modules/masquerade";

let server: Server;
let origin: string;
beforeAll(async () => {
  const app = express();
  await setupAuth(app);
  initAccessControl({ getUser: state.getUser, getUserPermissions: async () => [], hasPermission: async () => true }, {}, async () => true);
  app.get("/protected", isAuthenticated, async (req, res) => {
    const context = await buildContext(req);
    const effective = await getEffectiveUser(req.session, req.user);
    await resolveDbUser(req.user as any);
    state.work();
    res.json({ userId: context.user?.id, effectiveId: effective.dbUser?.id });
  });
  app.use((_error: unknown, _req: any, res: any, _next: any) => res.sendStatus(503));
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  origin = `http://127.0.0.1:${(server.address() as any).port}`;
});
afterAll(() => new Promise<void>((resolve, reject) => {
  server.closeAllConnections();
  server.close(error => error ? reject(error) : resolve());
}));
beforeEach(() => {
  state.users.clear();
  state.sessions.clear();
  for (const id of ["owner", "target"]) state.users.set(id, { id, email: `${id}@example.invalid`, isActive: true, sessionVersion: 0 });
  state.getUser.mockReset().mockImplementation(async id => structuredClone(state.users.get(id)));
  state.identity.mockReset().mockResolvedValue({ userId: "owner" });
  state.work.mockClear();
});
async function signIn(): Promise<string> {
  const response = await fetch(`${origin}/fixture/sign-in`, { method: "POST" });
  expect(response.status).toBe(200);
  return response.headers.get("set-cookie")!.split(";")[0];
}
const payload = () => ({
  passport: { user: { providerType: "local", claims: { sub: "external-owner" }, dbUser: structuredClone(state.users.get("owner")) } },
});

describe("live HTTP account authority", () => {
  it("shares one fresh owner read across restoration, Passport, guards and helpers, but not requests", async () => {
    const cookie = await signIn();
    state.getUser.mockClear();
    for (let i = 1; i <= 2; i++) {
      const response = await fetch(`${origin}/protected`, { headers: { Cookie: cookie } });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ userId: "owner", effectiveId: "owner" });
      expect(state.getUser).toHaveBeenCalledTimes(i);
    }
  });
  it.each(["inactive", "missing", "read-failure", "revoked-and-reactivated"])(
    "refuses a serialized active snapshot after %s before protected work", async change => {
      const cookie = await signIn();
      if (change === "inactive") state.users.get("owner").isActive = false;
      if (change === "missing") state.users.delete("owner");
      if (change === "read-failure") state.getUser.mockRejectedValue(new Error("unavailable"));
      if (change === "revoked-and-reactivated") state.users.get("owner").sessionVersion++;
      const response = await fetch(`${origin}/protected`, { headers: { Cookie: cookie } });
      expect(response.status).toBe(change === "read-failure" ? 503 : 401);
      expect(state.work).not.toHaveBeenCalled();
    },
  );
  it("allows a fresh sign-in, not an old cookie, after reactivation", async () => {
    const oldCookie = await signIn();
    state.users.get("owner").sessionVersion++;
    expect((await fetch(`${origin}/protected`, { headers: { Cookie: oldCookie } })).status).toBe(401);
    const freshCookie = await signIn();
    expect((await fetch(`${origin}/protected`, { headers: { Cookie: freshCookie } })).status).toBe(200);
  });
});

describe("owner and masqueraded account boundary", () => {
  it.each(["owner", "target"])("rejects a deactivated %s, even with an active counterpart", async id => {
    const sess = { ...payload(), masqueradeUserId: "target", masqueradeSessionVersion: 0 };
    state.users.get(id).isActive = false;
    expect(await currentSessionAccounts(sess)).toBeNull();
    expect((await getEffectiveUser(sess, sess.passport.user)).dbUser).toBeNull();
  });
  it("uses the target as actor and keeps the owner as provenance", async () => {
    const sess = { ...payload(), masqueradeUserId: "target", masqueradeSessionVersion: 0 };
    const result = await withRequestAccounts(() => getEffectiveUser(sess, sess.passport.user));
    expect(result.dbUser?.id).toBe("target");
    expect(result.originalUser?.id).toBe("owner");
    expect(state.getUser).toHaveBeenCalledTimes(2);
  });
  it("rejects a stale target generation after reactivation", async () => {
    const sess = { ...payload(), masqueradeUserId: "target", masqueradeSessionVersion: 0 };
    state.users.get("target").sessionVersion = 1;
    expect(await currentSessionAccounts(sess)).toBeNull();
    expect(await currentSessionAccounts({ ...sess, masqueradeSessionVersion: 1 })).not.toBeNull();
  });
  it("resolves a legacy external subject through its provider, not as an internal id", async () => {
    const sess = { passport: { user: { providerType: "saml", claims: { sub: "not-an-internal-id" } } } };
    expect((await currentSessionAccounts(sess))?.owner.id).toBe("owner");
    expect(state.identity).toHaveBeenCalledWith("saml", "not-an-internal-id");
    state.users.get("owner").sessionVersion = 1;
    expect(await currentSessionAccounts(sess)).toBeNull();
  });
});
