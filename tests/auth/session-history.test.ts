import { beforeEach, describe, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => ({
  enabled: vi.fn(() => true),
  outside: vi.fn((fn: () => unknown) => fn()),
  on: vi.fn(),
  error: vi.fn(),
}));

vi.mock("../../server/services/component-cache", () => ({ isComponentEnabledSync: fakes.enabled }));
vi.mock("../../server/storage/transaction-context", () => ({ runOutsideTransaction: fakes.outside }));
vi.mock("../../server/logger", () => ({ logger: { error: fakes.error } }));
vi.mock("../../server/services/event-bus", () => ({
  EventType: { SESSION_SAVE_AFTER: "session.save.after", SESSION_TOUCH_AFTER: "session.touch.after" },
  eventBus: { on: fakes.on },
}));

import { createSessionHistoryHandler, initializeSessionHistoryListener } from "../../server/services/session-history";
import { normalizeSessionIp } from "../../server/auth/session-ip";
import { captureRequestIpContext, getRequestContext } from "../../server/middleware/request-context";

const transition = {
  sid: "synthetic-session",
  created: false,
  previousUserId: null,
  userId: null,
  previousIp: "192.0.2.1",
  ip: "192.0.2.1",
  occurredAt: "2026-10-05T12:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  fakes.enabled.mockReturnValue(true);
});

describe("session history capture", () => {
  it.each([
    { created: true },
    { userId: "internal-user" },
    { previousUserId: "internal-user" },
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
      timestamp: new Date(event.occurredAt), data: null,
    });
    expect(fakes.outside).toHaveBeenCalledTimes(1);
  });

  it("ignores unchanged saves and touches before consulting the component", async () => {
    const create = vi.fn();
    await createSessionHistoryHandler({ create })(transition);
    expect(create).not.toHaveBeenCalled();
    expect(fakes.enabled).not.toHaveBeenCalled();
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
    const history = { create: vi.fn() };
    initializeSessionHistoryListener(history);
    initializeSessionHistoryListener(history);
    expect(fakes.on.mock.calls.map(([options]) => options.event)).toEqual([
      "session.save.after", "session.touch.after",
    ]);
  });
});

describe("session address normalization", () => {
  it("makes the established IP source available before sessions and auth routes", () => {
    const req = {
      headers: { "x-forwarded-for": "192.0.2.1, 192.0.2.2" },
      socket: { remoteAddress: "127.0.0.1" },
    } as unknown as Parameters<typeof captureRequestIpContext>[0];
    captureRequestIpContext(req, {} as Parameters<typeof captureRequestIpContext>[1], () => {
      expect(getRequestContext()).toEqual({ ipAddress: "192.0.2.1" });
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
