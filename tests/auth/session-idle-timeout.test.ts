import { beforeEach, describe, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => ({
  settingValue: undefined as unknown,
  sessionData: undefined as unknown,
  getByName: vi.fn(),
  getSessionData: vi.fn(),
  upsertSession: vi.fn(),
  deleteSession: vi.fn(),
  touchSession: vi.fn(),
}));

vi.mock("../../server/storage", () => ({
  storage: {
    variables: { getByName: fakes.getByName },
    sessions: {
      getSessionData: fakes.getSessionData,
      upsertSession: fakes.upsertSession,
      deleteSession: fakes.deleteSession,
      touchSession: fakes.touchSession,
    },
  },
}));

import { StorageSessionStore } from "../../server/auth/session-store";
import {
  DEFAULT_SESSION_IDLE_TIMEOUT,
  getSessionIdleTimeoutSettings,
  sessionIdleTimeoutSchema,
} from "../../server/auth/session-idle-timeout";

const NOW = new Date("2026-09-21T12:00:00.000Z");

function authenticatedSession(lastActivity?: string): any {
  return {
    cookie: { expires: new Date(NOW.getTime() + 7 * 24 * 60 * 60_000) },
    passport: { user: { dbUser: { id: "user-1" } } },
    ...(lastActivity ? { sessionIdleLastActivityAt: lastActivity } : {}),
  };
}

function getSession(store: StorageSessionStore): Promise<any> {
  return new Promise((resolve, reject) => {
    store.get("sid-1", (error, session) => (error ? reject(error) : resolve(session)));
  });
}

describe("session idle timeout settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    fakes.settingValue = undefined;
    fakes.sessionData = undefined;
    fakes.getByName.mockImplementation(async () =>
      fakes.settingValue === undefined
        ? undefined
        : { id: "variable-1", name: "session_idle_timeout", value: fakes.settingValue },
    );
    fakes.getSessionData.mockImplementation(async () => fakes.sessionData);
    fakes.upsertSession.mockResolvedValue({ created: false });
    fakes.deleteSession.mockResolvedValue({ deleted: true });
  });

  it("defaults safely when the row is missing or malformed", async () => {
    await expect(getSessionIdleTimeoutSettings({ variables: { getByName: fakes.getByName } } as any))
      .resolves.toEqual(DEFAULT_SESSION_IDLE_TIMEOUT);
    fakes.settingValue = { enabled: true, timeoutMinutes: "60" };
    await expect(getSessionIdleTimeoutSettings({ variables: { getByName: fakes.getByName } } as any))
      .resolves.toEqual(DEFAULT_SESSION_IDLE_TIMEOUT);
  });

  it("validates explicit duration bounds", () => {
    expect(sessionIdleTimeoutSchema.safeParse({ enabled: true, timeoutMinutes: 5 }).success).toBe(true);
    expect(sessionIdleTimeoutSchema.safeParse({ enabled: true, timeoutMinutes: 43200 }).success).toBe(true);
    expect(sessionIdleTimeoutSchema.safeParse({ enabled: true, timeoutMinutes: 4 }).success).toBe(false);
    expect(sessionIdleTimeoutSchema.safeParse({ enabled: true, timeoutMinutes: 5.5 }).success).toBe(false);
  });

  it("accepts and starts tracking a pre-existing authenticated session", async () => {
    fakes.settingValue = { enabled: true, timeoutMinutes: 30 };
    fakes.sessionData = authenticatedSession();

    const result = await getSession(new StorageSessionStore({ ttlMs: 7 * 24 * 60 * 60_000 }));

    expect(result.sessionIdleLastActivityAt).toBe(NOW.toISOString());
    expect(fakes.upsertSession).toHaveBeenCalledOnce();
    expect(fakes.deleteSession).not.toHaveBeenCalled();
  });

  it("rolls accepted activity and aligns expiry to the shorter idle limit", async () => {
    fakes.settingValue = { enabled: true, timeoutMinutes: 30 };
    fakes.sessionData = authenticatedSession(new Date(NOW.getTime() - 10 * 60_000).toISOString());

    await getSession(new StorageSessionStore({ ttlMs: 7 * 24 * 60 * 60_000 }));

    const [, saved, expire] = fakes.upsertSession.mock.calls[0];
    expect(expire).toEqual(new Date(NOW.getTime() + 30 * 60_000));
    expect(saved.cookie.expires).toEqual(expire);
  });

  it("rejects an idle session without renewing it", async () => {
    fakes.settingValue = { enabled: true, timeoutMinutes: 30 };
    fakes.sessionData = authenticatedSession(new Date(NOW.getTime() - 31 * 60_000).toISOString());

    await expect(getSession(new StorageSessionStore({ ttlMs: 7 * 24 * 60 * 60_000 })))
      .resolves.toBeNull();
    expect(fakes.deleteSession).toHaveBeenCalledWith("sid-1", "idle timeout");
    expect(fakes.upsertSession).not.toHaveBeenCalled();
  });

  it("uses the current setting so enabling or shortening applies immediately", async () => {
    fakes.sessionData = authenticatedSession(new Date(NOW.getTime() - 45 * 60_000).toISOString());
    fakes.settingValue = { enabled: false, timeoutMinutes: 60 };
    const store = new StorageSessionStore({ ttlMs: 7 * 24 * 60 * 60_000 });
    await expect(getSession(store)).resolves.not.toBeNull();

    fakes.sessionData = authenticatedSession(new Date(NOW.getTime() - 45 * 60_000).toISOString());
    fakes.settingValue = { enabled: true, timeoutMinutes: 30 };
    await expect(getSession(store)).resolves.toBeNull();
  });

  it("keeps the configured session lifetime as the expiry upper bound", async () => {
    fakes.settingValue = { enabled: true, timeoutMinutes: 43200 };
    fakes.sessionData = authenticatedSession(new Date(NOW.getTime() - 60_000).toISOString());
    const ttlMs = 7 * 24 * 60 * 60_000;

    await getSession(new StorageSessionStore({ ttlMs }));

    expect(fakes.upsertSession.mock.calls[0][2]).toEqual(new Date(NOW.getTime() + ttlMs));
  });

  it("does not create or refresh anonymous sessions", async () => {
    fakes.settingValue = { enabled: true, timeoutMinutes: 30 };
    fakes.sessionData = { cookie: {} };

    await expect(getSession(new StorageSessionStore({ ttlMs: 60_000 })))
      .resolves.toEqual({ cookie: {} });
    expect(fakes.upsertSession).not.toHaveBeenCalled();
    expect(fakes.deleteSession).not.toHaveBeenCalled();
  });
});
