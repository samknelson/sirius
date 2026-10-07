import { beforeEach, describe, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => ({
  enabled: vi.fn(() => true),
  outside: vi.fn((fn: () => unknown) => fn()),
  on: vi.fn(),
  error: vi.fn(),
  recordSignIn: vi.fn(),
  emit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../server/services/component-cache", () => ({ isComponentEnabledSync: fakes.enabled }));
vi.mock("../../server/storage/transaction-context", () => ({ runOutsideTransaction: fakes.outside }));
vi.mock("../../server/logger", () => ({ logger: { error: fakes.error } }));
vi.mock("../../server/services/event-bus", () => ({
  EventType: { SESSION_SAVE_AFTER: "session.save.after", SESSION_TOUCH_AFTER: "session.touch.after", AUTH_SIGN_IN_AFTER: "auth.sign-in.after" },
  eventBus: { on: fakes.on, emit: fakes.emit },
}));

import { createSessionHistoryHandler, initializeSessionHistoryListener, recordSuccessfulSignIn } from "../../server/services/session-history";
import { normalizeSessionIp } from "../../server/auth/session-ip";
import { captureRequestIpContext, getRequestContext, requestContext } from "../../server/middleware/request-context";

const transition = {
  sid: "synthetic-session",
  created: false,
  previousUserId: "internal-user",
  userId: "internal-user",
  previousIp: "192.0.2.1",
  ip: "192.0.2.1",
  occurredAt: "2026-10-05T12:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  fakes.enabled.mockReturnValue(true);
  fakes.recordSignIn.mockResolvedValue({ ipDecision: "known-ip", deviceDecision: "known-device" });
});

describe("session history capture", () => {
  it.each([
    { created: true },
    { previousUserId: null },
    { previousUserId: "first-user", userId: "second-user" },
    { ip: "192.0.2.2" },
    { userId: "internal-user", ip: "192.0.2.2" },
  ])("records exactly one opening or transition: %o", async (change) => {
    const create = vi.fn();
    const event = { ...transition, ...change };
    await createSessionHistoryHandler({ create })(event);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({
      sid: event.sid, userId: event.userId, ip: event.ip,
      timestamp: new Date(event.occurredAt), data: null, deviceId: null,
    });
    expect(fakes.outside).toHaveBeenCalledTimes(1);
  });

  it.each([
    { created: true, previousUserId: null, userId: null },
    { previousUserId: null, userId: null, ip: "192.0.2.2" },
    { previousUserId: null, userId: null, previousUserAgent: "Browser/1", userAgent: "Browser/2" },
    { previousUserId: "internal-user", userId: null },
    { previousUserId: "internal-user", userId: null, created: true, ip: "192.0.2.2", userAgent: "Browser/2" },
    { userId: "" },
  ])("skips anonymous history without storage access or errors: %o", async change => {
    const create = vi.fn();
    await createSessionHistoryHandler({ create })({ ...transition, ...change });
    expect(create).not.toHaveBeenCalled();
    expect(fakes.outside).not.toHaveBeenCalled();
    expect(fakes.enabled).not.toHaveBeenCalled();
    expect(fakes.error).not.toHaveBeenCalled();
  });

  it("ignores unchanged saves and touches before consulting the component", async () => {
    const create = vi.fn();
    await createSessionHistoryHandler({ create })(transition);
    expect(create).not.toHaveBeenCalled();
    expect(fakes.enabled).not.toHaveBeenCalled();
  });

  it.each([
    { created: true },
    { previousUserId: null },
    { ip: "192.0.2.2" },
    { previousUserAgent: "Browser/1", userAgent: "Browser/2" },
  ])("retains the verified request UUID on an existing observation: %o", async change => {
    const deviceId = "f865a51a-3656-4e89-bded-dd9e9da3b4c2";
    const create = vi.fn();
    await requestContext.run({ deviceId }, () =>
      createSessionHistoryHandler({ create })({ ...transition, ...change }));
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ deviceId }));
  });

  it("does not create an observation for the identifier alone", async () => {
    const create = vi.fn();
    await requestContext.run({ deviceId: "f865a51a-3656-4e89-bded-dd9e9da3b4c2" }, () =>
      createSessionHistoryHandler({ create })(transition));
    expect(create).not.toHaveBeenCalled();
  });

  it("snapshots the identifier before deferred writes and keeps requests separate", async () => {
    const first = "f865a51a-3656-4e89-bded-dd9e9da3b4c2";
    const second = "38dbe270-9156-461d-b592-8df2a332606f";
    const create = vi.fn();
    const deferred: Array<() => unknown> = [];
    fakes.outside.mockImplementationOnce(fn => { deferred.push(fn); })
      .mockImplementationOnce(fn => { deferred.push(fn); });
    const handler = createSessionHistoryHandler({ create });
    await requestContext.run({ deviceId: first }, () => handler({ ...transition, created: true }));
    await requestContext.run({ deviceId: second }, () => handler({ ...transition, created: true }));
    await requestContext.run({}, async () => {
      for (const write of deferred) await write();
    });
    expect(create.mock.calls.map(([entry]) => entry.deviceId)).toEqual([first, second]);
  });

  it("records authenticated device-only changes and preserves supplied text", async () => {
    const create = vi.fn();
    await createSessionHistoryHandler({ create })({
      ...transition, previousUserAgent: "Browser/1", userAgent: "Browser/2 (supplied)",
    });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      userId: "internal-user", data: { device: { user_agent: "Browser/2 (supplied)" } },
    }));
  });

  it.each([undefined, null, "", "Browser/1"])("ignores absent or unchanged device details: %s", async userAgent => {
    const create = vi.fn();
    await createSessionHistoryHandler({ create })({
      ...transition, previousUserAgent: "Browser/1", userAgent,
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("consults runtime enablement and never touches disabled storage", async () => {
    const create = vi.fn();
    const handler = createSessionHistoryHandler({ create });
    fakes.enabled.mockReturnValue(false);
    await handler({ ...transition, created: true });
    expect(create).not.toHaveBeenCalled();
    fakes.enabled.mockReturnValue(true);
    await handler({ ...transition, created: true });
    expect(create).toHaveBeenCalledTimes(1);
    expect(fakes.enabled).toHaveBeenCalledWith("system.session_history");
  });

  it("does not relay a failed query or its credentials into logs or the bus", async () => {
    const secret = "synthetic-cookie-query-canary";
    const create = vi.fn().mockRejectedValue(new Error(secret));
    await expect(createSessionHistoryHandler({ create })({ ...transition, created: true })).resolves.toBeUndefined();
    expect(fakes.error).toHaveBeenCalledWith("Session history capture failed", { service: "session-history" });
    expect(JSON.stringify(fakes.error.mock.calls)).not.toContain(secret);
  });

  it("registers save and touch listeners only once, without deletion capture", () => {
    const history = { create: vi.fn(), recordSignIn: fakes.recordSignIn };
    initializeSessionHistoryListener(history);
    initializeSessionHistoryListener(history);
    expect(fakes.on.mock.calls.map(([options]) => options.event)).toEqual([
      "session.save.after", "session.touch.after",
    ]);
  });
  it("does not race the login observer by recording its opening again", async () => {
    const create = vi.fn();
    await createSessionHistoryHandler({ create })({ ...transition, created: true, signInHistoryManaged: true });
    expect(create).not.toHaveBeenCalled();
  });
  it("emits only a safe immutable sign-in snapshot after capturing history", async () => {
    fakes.recordSignIn.mockResolvedValue({ ipDecision: "new-ip", deviceDecision: "known-device" });
    await recordSuccessfulSignIn({
      sid: "synthetic-cookie-canary", occurrenceId: "occurrence",
      userId: "internal-user", ip: "192.0.2.1", occurredAt: transition.occurredAt,
      authenticationSessionReference: "a".repeat(64),
      userAgent: "Browser/1 (supplied)",
      deviceId: "f865a51a-3656-4e89-bded-dd9e9da3b4c2",
    });
    expect(fakes.recordSignIn).toHaveBeenCalledOnce();
    expect(fakes.recordSignIn).toHaveBeenCalledWith(expect.objectContaining({
      data: { device: { user_agent: "Browser/1 (supplied)" } },
      authenticationSessionReference: "a".repeat(64),
      deviceId: "f865a51a-3656-4e89-bded-dd9e9da3b4c2",
    }));
    const [event, payload] = fakes.emit.mock.calls[0];
    expect(event).toBe("auth.sign-in.after");
    expect(payload.ipDecision).toBe("new-ip");
    expect(payload.deviceDecision).toBe("known-device");
    expect(payload.userAgent).toBe("Browser/1 (supplied)");
    expect(Object.isFrozen(payload)).toBe(true);
    expect(payload).not.toHaveProperty("sid");
    expect(payload).not.toHaveProperty("authenticationSessionReference");
    expect(payload).not.toHaveProperty("deviceId");
    expect(JSON.stringify(payload)).not.toContain("f865a51a-3656-4e89-bded-dd9e9da3b4c2");
    expect(JSON.stringify(payload)).not.toContain("synthetic-cookie-canary");
  });
  it("does not query history when disabled, and marks classification unavailable", async () => {
    fakes.enabled.mockReturnValue(false);
    await recordSuccessfulSignIn({ sid: "cookie", occurrenceId: "occurrence", userId: "internal-user", ip: null, occurredAt: transition.occurredAt });
    expect(fakes.recordSignIn).not.toHaveBeenCalled();
    expect(fakes.emit.mock.calls[0][1].ipDecision).toBeNull();
    expect(fakes.emit.mock.calls[0][1].deviceDecision).toBeNull();
  });
  it("preserves a restored session observation without emitting a new sign-in", async () => {
    fakes.recordSignIn.mockResolvedValue({ ipDecision: "restored-session", deviceDecision: "restored-session" });
    await recordSuccessfulSignIn({ sid: "cookie", occurrenceId: "occurrence", userId: "internal-user", ip: "192.0.2.2", occurredAt: transition.occurredAt });
    expect(fakes.recordSignIn).toHaveBeenCalledOnce();
    expect(fakes.emit).not.toHaveBeenCalled();
  });
  it("stores null rather than borrowing a later request's device on sign-in", async () => {
    await requestContext.run({ deviceId: "f865a51a-3656-4e89-bded-dd9e9da3b4c2" }, () =>
      recordSuccessfulSignIn({
        sid: "cookie", occurrenceId: "occurrence", userId: "internal-user",
        ip: "192.0.2.2", occurredAt: transition.occurredAt,
      }));
    expect(fakes.recordSignIn).toHaveBeenCalledWith(expect.objectContaining({ deviceId: null }));
  });
  it("does not invent novelty or relay query credentials when history fails", async () => {
    fakes.recordSignIn.mockRejectedValue(new Error("synthetic-cookie-query-canary"));
    await recordSuccessfulSignIn({ sid: "cookie", occurrenceId: "occurrence", userId: "internal-user", ip: "192.0.2.2", occurredAt: transition.occurredAt });
    expect(fakes.emit.mock.calls[0][1].ipDecision).toBeNull();
    expect(fakes.emit.mock.calls[0][1].deviceDecision).toBeNull();
    expect(JSON.stringify(fakes.error.mock.calls)).not.toContain("synthetic-cookie-query-canary");
  });
});

describe("session address normalization", () => {
  it("makes the established IP source available before sessions and auth routes", () => {
    const req = {
      headers: { "x-forwarded-for": "192.0.2.1, 192.0.2.2" },
      socket: { remoteAddress: "127.0.0.1" },
    } as unknown as Parameters<typeof captureRequestIpContext>[0];
    captureRequestIpContext(req, {} as Parameters<typeof captureRequestIpContext>[1], () => {
      expect(getRequestContext()).toEqual({ ipAddress: "192.0.2.1", userAgent: null });
    });
    expect(getRequestContext()).toBeUndefined();
  });

  it("captures supplied User-Agent before authentication without changing it", () => {
    const req = {
      headers: { "user-agent": "ExampleBrowser/4.2 (Example OS; supplied)" },
      socket: { remoteAddress: "192.0.2.1" },
    } as unknown as Parameters<typeof captureRequestIpContext>[0];
    captureRequestIpContext(req, {} as Parameters<typeof captureRequestIpContext>[1], () => {
      expect(getRequestContext()?.userAgent).toBe(req.headers["user-agent"]);
    });
    expect(getRequestContext()).toBeUndefined();
  });

  it.each([
    ["192.0.2.1", "192.0.2.1"],
    ["::ffff:192.0.2.1", "192.0.2.1"],
    ["::FFFF:c000:201", "192.0.2.1"],
    [" 2001:0DB8:0000:0000:0000:0000:0000:0001 ", "2001:db8::1"],
    ["unknown", null], ["", null], [undefined, null],
    ["forwarded-header-not-an-ip", null],
  ])("normalizes %s to %s", (input, expected) => {
    expect(normalizeSessionIp(input)).toBe(expected);
  });
});
