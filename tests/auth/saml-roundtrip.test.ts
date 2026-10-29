import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import session from "express-session";
import passport from "passport";
import type { Server } from "node:http";

const f = vi.hoisted(() => ({
  info: vi.fn(), error: vi.fn(), failSave: false, failRead: false,
  rows: new Map<string, any>(),
  user: { id: "fixture-user", email: "fixture@example.invalid", isActive: true },
}));
vi.mock("../../server/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  storageLogger: { info: f.info, error: f.error },
}));
vi.mock("../../server/storage", () => ({
  storage: {
    authIdentities: {
      getByProviderAndExternalId: async () => ({ id: "identity", userId: f.user.id }),
      update: vi.fn(), updateLastUsed: vi.fn(),
    },
    users: {
      getUser: async () => f.user, updateUser: async () => f.user,
      updateUserLastLogin: vi.fn(),
    },
    sessions: {
      getSessionData: async (sid: string) => {
        if (f.failRead) throw new Error("fixture read failure");
        return f.rows.get(sid);
      },
      upsertSession: async (sid: string, data: any) => {
        if (f.failSave) throw new Error("fixture save failure");
        f.rows.set(sid, JSON.parse(JSON.stringify(data)));
      },
      deleteSession: async (sid: string) => { f.rows.delete(sid); },
    },
  },
}));
vi.mock("../../server/auth/provisioning", () => ({
  maybeProvisionUser: vi.fn(), reconcileMappedRoles: async () => ({ outcome: "unchanged" }),
}));
vi.mock("../../server/auth/session-idle-timeout", () => ({
  getSessionIdleTimeoutSettings: async () => ({ enabled: false, timeoutMinutes: 30 }),
}));
vi.mock("../../server/services/component-cache", () => ({ isComponentEnabledSync: () => false }));
vi.mock("../../server/middleware/request-context", () => ({ getRequestContext: () => undefined }));
vi.mock("../../server/config/env-registry", () => ({
  getEnvironmentVariable: (key: string) => ({
    PUBLIC_URL: "https://canonical.example.invalid",
    SAML_ENTRY_POINT: "https://idp.example.invalid/sso",
    SAML_ISSUER: "fixture-issuer", SAML_CERT: "fixture-cert",
  } as Record<string, string>)[key],
}));

import { createProvider } from "../../server/auth/providers/saml";
import { StorageSessionStore } from "../../server/auth/session-store";
import { observeSamlCallback } from "../../server/auth/saml-roundtrip";

let server: Server;
let origin: string;
let validate: ReturnType<typeof vi.spyOn>;
const callback = "/api/auth/saml/callback";

beforeEach(async () => {
  vi.clearAllMocks();
  f.rows.clear(); f.failSave = false; f.failRead = false;
  const app = express();
  app.use(observeSamlCallback);
  app.use(express.urlencoded({ extended: false }));
  app.use(session({
    secret: "fixture-only-secret", resave: false, saveUninitialized: false,
    store: new StorageSessionStore({ ttlMs: 60_000 }),
  }));
  app.use(passport.initialize());
  app.use(passport.session());
  passport.serializeUser((user, done) => done(null, user));
  passport.deserializeUser((user: Express.User, done) => done(null, user));
  const provider = createProvider({ type: "saml", enabled: true });
  await provider.setup(app);
  // Build the real strategy, then stub only cryptographic IdP verification.
  // Express, Passport, regeneration, storage and cookie restoration remain real.
  app.get("/api/auth/user", (req, res) => {
    res.status(req.isAuthenticated() ? 200 : 401).json({ authenticated: req.isAuthenticated() });
  });
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  origin = `http://127.0.0.1:${(server.address() as any).port}`;
  await fetch(`${origin}/api/auth/saml/login`, { redirect: "manual" });
  const strategy = (passport as any)._strategy("saml");
  validate = vi.spyOn(strategy._saml, "validatePostResponseAsync").mockResolvedValue({
    profile: { nameID: "fixture-subject", email: f.user.email }, loggedOut: false,
  });
});
afterEach(async () => {
  validate.mockRestore();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function post(body = "SAMLResponse=fixture-assertion") {
  return fetch(`${origin}${callback}?private=do-not-log`, {
    method: "POST", body, headers: { "Content-Type": "application/x-www-form-urlencoded" },
    redirect: "manual",
  });
}
const operations = () => f.info.mock.calls.map(([, meta]) => meta.operation);

describe("SAML application session handoff", () => {
  it("persists Passport's session once and restores it before the normal destination", async () => {
    const response = await post();
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/api/auth/saml/complete");
    const cookie = response.headers.get("set-cookie")!.split(";")[0];
    const restored = await fetch(`${origin}/api/auth/saml/complete`, {
      headers: { Cookie: cookie }, redirect: "manual",
    });
    expect(restored.headers.get("location")).toBe("/");
    const user = await fetch(`${origin}/api/auth/user`, { headers: { Cookie: cookie } });
    expect(user.status).toBe(200);
    expect(operations()).toEqual(expect.arrayContaining([
      "saml_initiation", "saml_callback_received", "saml_verification_started",
      "saml_assertion_verified", "saml_session_established", "saml_session_restored",
    ]));
    const logs = JSON.stringify(f.info.mock.calls.filter(([, meta]) => meta.operation.startsWith("saml_")));
    expect(logs).not.toContain("fixture-assertion");
    expect(logs).not.toContain("do-not-log");
    expect(logs).not.toContain(cookie);
    expect(logs).not.toContain("fixture@example");
  });

  it("rejects a missing response instead of starting a second IdP login", async () => {
    const response = await post("");
    expect(response.headers.get("location")).toMatch(/error=saml_response_missing&ref=SAML-/);
    expect(validate).not.toHaveBeenCalled();
    expect(operations()).not.toContain("saml_assertion_verified");
  });

  it("uses the referenced error surface when assertion verification rejects", async () => {
    validate.mockRejectedValue(new Error("Invalid signature"));
    const response = await post();
    expect(response.headers.get("location")).toMatch(/error=saml_callback_failed&ref=SAML-/);
    expect(operations()).toContain("saml_verification_failed");
    expect(operations()).not.toContain("saml_session_established");
  });

  it("does not announce success if the authenticated session cannot be saved", async () => {
    f.failSave = true;
    const response = await post();
    expect(response.headers.get("location")).toMatch(/error=session_failed&ref=SAML-/);
    expect(operations()).toContain("saml_session_failed");
    expect(operations()).not.toContain("saml_session_established");
  });

  it("reports a lost cookie separately from a session-store read failure", async () => {
    const response = await post();
    const cookie = response.headers.get("set-cookie")!.split(";")[0];
    const missing = await fetch(`${origin}/api/auth/saml/complete`, { redirect: "manual" });
    expect(missing.headers.get("location")).toContain("error=saml_session_missing");
    f.failRead = true;
    const failed = await fetch(`${origin}/api/auth/saml/complete`, {
      headers: { Cookie: cookie }, redirect: "manual",
    });
    expect(failed.headers.get("location")).toContain("error=saml_handoff_failed");
  });

  it("records initiation without inventing callback evidence or a cookie diagnosis", () => {
    expect(operations()).toContain("saml_initiation");
    expect(operations()).not.toContain("saml_callback_received");
    expect(JSON.stringify(f.info.mock.calls)).not.toMatch(/cookie|sameSite/i);
  });

  it("records callback entry even when body parsing fails", async () => {
    const response = await post("SAMLResponse=%E0%A4%A&" + "x=1&".repeat(1001));
    expect(response.headers.get("location")).toContain("error=saml_handoff_failed");
    expect(operations()).toContain("saml_callback_received");
    expect(validate).not.toHaveBeenCalled();
  });
});
