import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";

const fakes = vi.hoisted(() => ({
  record: vi.fn().mockResolvedValue(undefined),
  error: vi.fn(),
  context: { deviceId: "f865a51a-3656-4e89-bded-dd9e9da3b4c2" } as { deviceId?: string },
}));
vi.mock("../../server/services/session-history", () => ({ recordSuccessfulSignIn: fakes.record }));
vi.mock("../../server/middleware/request-context", () => ({
  getRequestContext: () => ({ ipAddress: "::ffff:192.0.2.10", userId: "not-the-session-owner", userAgent: "Browser/1 (supplied)", ...fakes.context }),
}));
vi.mock("../../server/logger", () => ({ logger: { error: fakes.error } }));

import { observeSuccessfulSignIns } from "../../server/auth/sign-in-events";
import { getSessionAuthenticationContext, runAsSessionRestoration } from "../../server/auth/session-authentication-context";

function request(error?: Error) {
  const original = vi.fn((_user, _options, done) => done(error));
  const req = { logIn: original, login: original, sessionID: "synthetic-cookie-only-for-storage" } as unknown as Request;
  const next = vi.fn();
  observeSuccessfulSignIns(req, {} as Response, next as NextFunction);
  expect(next).toHaveBeenCalledOnce();
  return { req, original };
}
const user = { providerType: "local", dbUser: { id: "actual-session-owner" } };

beforeEach(() => {
  vi.clearAllMocks();
  fakes.record.mockResolvedValue(undefined);
  fakes.context.deviceId = "f865a51a-3656-4e89-bded-dd9e9da3b4c2";
});

describe("observation of the existing Passport login boundary", () => {
  it.each(["local", "saml", "replit", "clerk"])("observes %s without replacing provider authentication", async (providerType) => {
    const { req, original } = request();
    await new Promise<void>((resolve, reject) => req.login(
      { ...user, providerType }, error => error ? reject(error) : resolve(),
    ));
    expect(original).toHaveBeenCalledOnce();
    expect(req.login).toBe(req.logIn);
    expect(fakes.record).toHaveBeenCalledWith(expect.objectContaining({
      userId: "actual-session-owner", ip: "192.0.2.10",
      sid: "synthetic-cookie-only-for-storage",
      userAgent: "Browser/1 (supplied)",
      deviceId: "f865a51a-3656-4e89-bded-dd9e9da3b4c2",
      occurrenceId: expect.stringMatching(/^[a-f0-9-]{36}$/),
    }));
  });
  it("observes Passport authenticate's logIn alias and reserves history until success", async () => {
    const { req, original } = request();
    original.mockImplementation((_user, _options, done) => {
      expect(fakes.record).not.toHaveBeenCalled();
      expect(getSessionAuthenticationContext()).toMatchObject({ historyManaged: true, userId: user.dbUser.id });
      done();
    });
    await new Promise<void>(resolve => req.logIn(user, { session: true }, () => resolve()));
    expect(fakes.record).toHaveBeenCalledOnce();
    expect(getSessionAuthenticationContext()).toBeUndefined();
  });
  it("never emits on failed session establishment", async () => {
    const failure = new Error("synthetic-save-failure");
    const { req } = request(failure);
    const result = await new Promise(resolve => req.login(user, resolve));
    expect(result).toBe(failure);
    expect(fakes.record).not.toHaveBeenCalled();
  });
  it("snapshots the device before session establishment and deferred history work", async () => {
    const { req, original } = request();
    original.mockImplementation((_user, _options, done) => {
      fakes.context.deviceId = "38dbe270-9156-461d-b592-8df2a332606f";
      done();
    });
    await new Promise<void>(resolve => req.login(user, () => resolve()));
    expect(fakes.record).toHaveBeenCalledWith(expect.objectContaining({
      deviceId: "f865a51a-3656-4e89-bded-dd9e9da3b4c2",
    }));
  });
  it("leaves the device unavailable when there is no verified request identifier", async () => {
    fakes.context.deviceId = undefined;
    const { req } = request();
    await new Promise<void>(resolve => req.login(user, () => resolve()));
    expect(fakes.record).toHaveBeenCalledWith(expect.objectContaining({ deviceId: undefined }));
  });
  it("does not treat stateless authentication or explicit restoration as sign-in", async () => {
    const { req } = request();
    req.login(user, { session: false }, () => {});
    runAsSessionRestoration(() => req.login(user, () => {}));
    expect(fakes.record).not.toHaveBeenCalled();
  });
  it("does nothing just because a normal authenticated request passes the middleware", () => {
    request();
    expect(fakes.record).not.toHaveBeenCalled();
  });
  it("does not use an external subject as an internal account", () => {
    const { req } = request();
    req.login({ claims: { sub: "external-subject" } }, () => {});
    expect(fakes.record).not.toHaveBeenCalled();
  });
  it("a history failure cannot turn successful authentication into failure", async () => {
    const { req } = request();
    fakes.record.mockRejectedValue(new Error("synthetic-secret-query-canary"));
    const result = await new Promise(resolve => req.login(user, resolve));
    expect(result).toBeUndefined();
    expect(JSON.stringify(fakes.error.mock.calls)).not.toContain("synthetic-secret-query-canary");
  });
});
