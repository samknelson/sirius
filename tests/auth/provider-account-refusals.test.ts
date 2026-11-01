import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Express, RequestHandler } from "express";
import { getAuthErrorCategoryReason } from "../../client/src/pages/auth-error-categories";

const f = vi.hoisted(() => ({
  identity: vi.fn(), user: vi.fn(), email: vi.fn(), update: vi.fn(),
  createIdentity: vi.fn(), provision: vi.fn(), lastLogin: vi.fn(), lastUsed: vi.fn(),
  error: vi.fn(), getAuth: vi.fn(), clerkUser: vi.fn(),
  createUser: vi.fn(),
  verify: undefined as any, verificationError: undefined as Error | undefined,
}));
vi.mock("../../server/storage", () => ({ storage: {
  users: {
    getUser: f.user, getUserByEmail: f.email, updateUser: f.update, updateUserLastLogin: f.lastLogin,
    createUser: f.createUser, getRoleByName: vi.fn(), getUserRoles: async () => [],
  },
  authIdentities: {
    getByProviderAndExternalId: f.identity, update: vi.fn(),
    updateLastUsed: f.lastUsed, create: f.createIdentity,
  },
  workers: {
    getWorkerByContactEmail: vi.fn(),
    getWorker: async () => ({ id: "worker", contactId: "contact" }),
  },
  contacts: { getContact: async () => ({ email: "fixture@example.invalid" }) },
  variables: { getByName: vi.fn() },
} }));
vi.mock("../../server/auth/provisioning", () => ({ maybeProvisionUser: f.provision }));
vi.mock("../../server/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  storageLogger: { info: vi.fn(), error: f.error },
}));
vi.mock("../../server/middleware/request-context", () => ({ getRequestContext: () => undefined }));
vi.mock("../../server/config/env-registry", () => ({ getEnvironmentVariable: () => undefined }));
vi.mock("openid-client", () => ({ discovery: async () => ({}) }));
vi.mock("openid-client/passport", () => ({
  Strategy: class {
    constructor(_options: unknown, verify: any) { f.verify = verify; }
  },
}));
vi.mock("passport", () => ({ default: {
  use: vi.fn(),
  authenticate: (_name: string, options: any) => async (req: any, res: any, next: any) => {
    // The strategy's verified callback is never invoked on a protocol failure.
    if (f.verificationError) return next(f.verificationError);
    await f.verify(req.tokens, (error: any, user: any) => {
      if (error) return next(error);
      req.login(user, (loginError: any) => loginError ? next(loginError) : res.redirect(options.successReturnToOrRedirect));
    });
  },
} }));
vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_req: any, _res: any, next: any) => next(),
  getAuth: f.getAuth,
  createClerkClient: () => ({ users: { getUser: f.clerkUser } }),
}));

import { createProvider as replitProvider } from "../../server/auth/providers/replit";
import { createProvider as clerkProvider } from "../../server/auth/providers/clerk";
import { getSessionAuthenticationContext } from "../../server/auth/session-authentication-context";

const user = { id: "local-user", email: "fixture@example.invalid", isActive: true, sessionVersion: 7 };
const claims = { sub: "verified-subject", email: user.email, exp: 9999999999 };
beforeEach(() => {
  vi.clearAllMocks();
  f.verificationError = undefined;
  f.identity.mockResolvedValue({ id: "identity", userId: user.id });
  f.user.mockResolvedValue(user);
  f.email.mockResolvedValue(user);
  f.update.mockResolvedValue(user);
  f.createUser.mockResolvedValue(user);
  f.provision.mockResolvedValue(null);
  f.getAuth.mockReturnValue({ userId: claims.sub, sessionId: "verified-clerk-session" });
  f.clerkUser.mockResolvedValue({
    primaryEmailAddressId: "email",
    emailAddresses: [{ id: "email", emailAddress: user.email }],
  });
});

async function harness(provider: "replit" | "clerk") {
  const middlewares: RequestHandler[] = [];
  const routes = new Map<string, RequestHandler>();
  const app = {
    use: (fn: RequestHandler) => middlewares.push(fn),
    post: (path: string, handler: RequestHandler) => routes.set(path, handler),
  } as unknown as Express;
  const instance = provider === "replit"
    ? replitProvider({ type: "replit", enabled: true, clientId: "fixture" })
    : clerkProvider({ type: "clerk", enabled: true, publishableKey: "fixture", secretKey: "fixture" });
  await instance.setup(app);
  const handler = provider === "replit" ? instance.getCallbackHandler() : middlewares[1];
  async function request(overrides: Record<string, any> = {}, completeRegistration = false) {
    let context: unknown;
    let finish!: () => void;
    const finished = new Promise<void>(resolve => { finish = resolve; });
    const req: any = {
      path: provider === "clerk" ? "/api/auth/user" : "/api/callback", method: "GET", hostname: "example.invalid",
      headers: { accept: "text/html" }, session: {},
      isAuthenticated: () => false,
      tokens: { claims: () => claims, access_token: "verified-token" },
      login: vi.fn((_user, done) => { context = getSessionAuthenticationContext(); done(); }),
      ...overrides,
    };
    const res: any = {
      redirect: vi.fn(() => finish()), json: vi.fn(() => finish()), setHeader: vi.fn(),
      status: vi.fn().mockReturnThis(), headersSent: false,
    };
    const next = vi.fn(() => {
      if (!completeRegistration) return finish();
      return routes.get("/api/auth/complete-registration")!(req, res, finish);
    });
    await handler(req, res, next);
    await finished;
    return { req, res, next, context };
  }
  return request;
}

function refusalUrl(provider: "replit" | "clerk", response: any): URL {
  return new URL(provider === "clerk"
    ? response.res.json.mock.calls[0][0].authErrorUrl
    : response.res.redirect.mock.calls[0][0], "https://example.invalid");
}

describe.each(["replit", "clerk"] as const)("%s verified account refusals", provider => {
  it.each(["identity", "email"] as const)("explains an inactive account found by %s with the original log reference", async path => {
    f.user.mockResolvedValue({ ...user, isActive: false });
    f.email.mockResolvedValue({ ...user, isActive: false });
    if (path === "email") f.identity.mockResolvedValue(undefined);
    const response = await (await harness(provider))();
    expect(response.req.login).not.toHaveBeenCalled();
    expect(f.update).not.toHaveBeenCalled();
    expect(f.createIdentity).not.toHaveBeenCalled();
    const url = refusalUrl(provider, response);
    const diagnostic = f.error.mock.calls[0][1];
    expect(url.pathname).toBe("/auth-error");
    expect(url.searchParams.get("error")).toBe("access_denied");
    expect(url.searchParams.get("category")).toBe("inactive_account");
    expect(url.searchParams.get("ref")).toBe(diagnostic.reference);
    expect(diagnostic).toMatchObject({ module: "auth", operation: "access_denied", category: "inactive_account", provider });
    expect(getAuthErrorCategoryReason("access_denied", "inactive_account")).toContain("Your account is inactive");
  });

  it.each(["identity_found_but_user_missing", "no_provisioned_account", "missing_email"])(
    "logs %s specifically but leaves the public explanation generic", async reason => {
      if (reason === "identity_found_but_user_missing") f.user.mockResolvedValue(undefined);
      else {
        f.identity.mockResolvedValue(undefined);
        f.email.mockResolvedValue(undefined);
      }
      if (reason === "missing_email") f.clerkUser.mockResolvedValue({ emailAddresses: [] });
      const request = await harness(provider);
      const response = await request(reason === "missing_email" && provider === "replit"
        ? { tokens: { claims: () => ({ sub: claims.sub }) } } : {});
      expect(response.req.login).not.toHaveBeenCalled();
      const url = refusalUrl(provider, response);
      expect(url.searchParams.get("category")).toBeNull();
      expect(url.searchParams.get("ref")).toBe(f.error.mock.calls[0][1].reference);
      expect(f.error.mock.calls[0][1].category).toBe(reason);
      expect(url.href).not.toContain(user.email);
    },
  );

  it.each(["invalid", "expired"])("does not look up or disclose an account with %s credentials", async failure => {
    f.user.mockResolvedValue({ ...user, isActive: false });
    if (provider === "replit") f.verificationError = new Error(`${failure} ID token`);
    else if (failure === "expired") f.getAuth.mockReturnValue({ userId: null });
    else f.getAuth.mockImplementation(() => { throw new Error("Invalid Clerk verification"); });
    const response = await (await harness(provider))();
    expect(f.identity).not.toHaveBeenCalled();
    expect(f.error).not.toHaveBeenCalled();
    expect(response.req.login).not.toHaveBeenCalled();
    if (provider === "replit") expect(response.res.redirect).toHaveBeenCalledWith("/unauthorized");
    else expect(response.next).toHaveBeenCalledOnce();
  });

  it("preserves successful sign-in and the account generation", async () => {
    const response = await (await harness(provider))();
    expect(response.req.login).toHaveBeenCalledWith(expect.objectContaining({
      dbUser: user, providerType: provider,
      ...(provider === "clerk" ? { authenticationSessionReference: expect.stringMatching(/^[a-f0-9]{64}$/) } : {}),
    }), expect.any(Function));
    expect(f.lastLogin).toHaveBeenCalledWith(user.id);
    expect(f.error).not.toHaveBeenCalled();
    if (provider === "replit") expect(response.res.redirect).toHaveBeenCalledWith("/");
    else expect(response.context).toMatchObject({ reason: "sign-in" });
  });

  it("still permits automatic provisioning", async () => {
    f.identity.mockResolvedValue(undefined);
    f.email.mockResolvedValue(undefined);
    f.provision.mockResolvedValue({ user, identity: { id: "new-identity" } });
    const response = await (await harness(provider))();
    expect(f.provision).toHaveBeenCalledWith(provider, expect.objectContaining({ externalId: claims.sub, email: user.email }));
    expect(response.req.login).toHaveBeenCalledOnce();
  });

  it("still links an active pre-provisioned account by email", async () => {
    f.identity.mockResolvedValue(undefined);
    const response = await (await harness(provider))();
    expect(f.createIdentity).toHaveBeenCalledWith(expect.objectContaining({
      providerType: provider, userId: user.id, externalId: claims.sub,
    }));
    expect(f.update).toHaveBeenCalledWith(user.id, expect.objectContaining({ accountStatus: "linked" }));
    expect(response.req.login).toHaveBeenCalledOnce();
  });
});

describe("Clerk request delivery and session boundaries", () => {
  it("delivers the same cached reference to the SPA and does not loop on the error page", async () => {
    f.user.mockResolvedValue({ ...user, isActive: false });
    const request = await harness("clerk");
    const first = await request({ path: "/api/auth/user", headers: {} });
    expect(first.res.status).toHaveBeenCalledWith(403);
    const url = first.res.json.mock.calls[0][0].authErrorUrl;
    const second = await request();
    expect(second.res.json).toHaveBeenCalledWith({ authErrorUrl: url });
    expect(f.error).toHaveBeenCalledOnce();
    const errorPage = await request({ path: "/auth-error" });
    expect(errorPage.res.redirect).not.toHaveBeenCalled();
    expect(errorPage.next).toHaveBeenCalledOnce();
    expect(first.res.setHeader).toHaveBeenCalledWith("Cache-Control", "private, no-store");
  });

  it("lets a new unlinked Clerk identity return to registration and finish enrollment", async () => {
    f.identity.mockResolvedValue(undefined);
    f.email.mockResolvedValue(undefined);
    const request = await harness("clerk");
    const landing = await request({ path: "/register" });
    expect(landing.res.redirect).not.toHaveBeenCalled();
    expect(landing.next).toHaveBeenCalledOnce();
    // The initial current-user request can return a generic refusal, but the
    // registration POST must still run through the same provider middleware.
    const lookup = await request();
    expect(lookup.res.json).toHaveBeenCalledWith({ authErrorUrl: expect.not.stringContaining("inactive_account") });
    const registration = await request({
      path: "/api/auth/complete-registration", method: "POST",
      session: { verifiedWorker: { workerId: "worker", verifiedAt: Date.now() } },
    }, true);
    expect(registration.res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    expect(f.createUser).toHaveBeenCalledOnce();
    expect(f.createIdentity).toHaveBeenCalledWith(expect.objectContaining({
      providerType: "clerk", externalId: claims.sub, metadata: { workerId: "worker" },
    }));
    expect(registration.req.login).toHaveBeenCalledOnce();
  });

  it.each(["/login", "/register", "/api/logout"])("does not intercept the document or logout route %s", async path => {
    f.user.mockResolvedValue({ ...user, isActive: false });
    const response = await (await harness("clerk"))({ path });
    expect(response.res.redirect).not.toHaveBeenCalled();
    expect(response.res.json).not.toHaveBeenCalled();
    expect(response.next).toHaveBeenCalledOnce();
  });

  it("leaves restored/revoked application-session refusals generic", async () => {
    f.user.mockResolvedValue({ ...user, isActive: false });
    const response = await (await harness("clerk"))({
      path: "/api/auth/user", session: { passport: { user: { dbUser: user } } },
    });
    expect(response.res.json).not.toHaveBeenCalled();
    expect(response.res.redirect).not.toHaveBeenCalled();
    expect(f.error).not.toHaveBeenCalled();
    expect(response.next).toHaveBeenCalledOnce();
  });

  it("does not turn a failed session establishment into an inactive-account refusal", async () => {
    const response = await (await harness("clerk"))({
      login: vi.fn((_user, done) => done(new Error("session revoked"))),
    });
    expect(response.res.redirect).not.toHaveBeenCalled();
    expect(f.error).not.toHaveBeenCalled();
    expect(response.next).toHaveBeenCalledOnce();
  });

  it("keeps an expired app-session renewal refusal generic", async () => {
    f.user.mockResolvedValue({ ...user, isActive: false });
    const logout = vi.fn(done => done());
    const response = await (await harness("clerk"))({
      isAuthenticated: () => true,
      user: { expires_at: 1, authenticationSessionReference: "old-reference" },
      logout,
    });
    expect(logout).toHaveBeenCalledOnce();
    expect(response.req.login).not.toHaveBeenCalled();
    expect(response.res.redirect).not.toHaveBeenCalled();
    expect(f.error).not.toHaveBeenCalled();
  });
});
