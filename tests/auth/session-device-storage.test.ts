import { beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/pg-proxy";

const state = vi.hoisted(() => ({
  client: undefined as unknown,
  context: {} as { ipAddress?: string; userAgent?: string | null },
  emit: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../server/storage/transaction-context", () => ({
  getClient: () => state.client,
  runInTransaction: (fn: () => unknown) => fn(),
  runOutsideTransaction: (fn: () => unknown) => fn(),
  onAfterCommit: (fn: () => unknown) => fn(),
}));
vi.mock("../../server/storage/maintenance", () => ({
  allowInMaintenanceMode: (fn: () => unknown) => fn(),
}));
vi.mock("../../server/middleware/request-context", () => ({ getRequestContext: () => state.context }));
vi.mock("../../server/services/event-bus", () => ({
  EventType: { SESSION_SAVE_AFTER: "session.save.after", SESSION_TOUCH_AFTER: "session.touch.after" },
  eventBus: { emit: state.emit },
}));
vi.mock("../../server/logger", () => ({ logger: { error: vi.fn() } }));
import { createSessionStorage } from "../../server/storage/system/sessions";
import { createSessionHistoryStorage } from "../../server/storage/system/session-history";

beforeEach(() => {
  state.context = { ipAddress: "192.0.2.1", userAgent: "Browser/2" };
  state.emit.mockClear();
});

describe("live-session device observations", () => {
  function database(previous: string | null) {
    const queries: { sql: string; params: unknown[] }[] = [];
    const client = drizzle(async (sql, params) => {
      queries.push({ sql, params });
      return { rows: sql.includes("FOR UPDATE")
        ? [{ old_user_id: null, user_id: null, old_ip: "192.0.2.1", old_user_agent: previous }]
        : [] };
    });
    // pg-proxy's raw execute returns rows directly; node-postgres returns
    // a QueryResult. Adapt only that method to the production driver shape.
    state.client = new Proxy(client, {
      get(target, key) {
        if (key === "execute") return async (query: Parameters<typeof client.execute>[0]) => ({
          rows: await target.execute(query),
        });
        return Reflect.get(target, key);
      },
    });
    return queries;
  }

  it("reports a device-only touch while keeping the idle expiry unchanged", async () => {
    const queries = database("Browser/1");
    await createSessionStorage().touchSession("synthetic", new Date(), { ipOnly: true });
    expect(state.emit).toHaveBeenCalledWith("session.touch.after", expect.objectContaining({
      previousUserAgent: "Browser/1", userAgent: "Browser/2", previousIp: "192.0.2.1", ip: "192.0.2.1",
    }));
    const update = queries.find(query => query.sql.startsWith("update"))!;
    expect(update.sql).toContain("'{_sessionClientUserAgent}'");
    expect(update.sql).not.toContain('"expire"');
    expect(update.params).toContain('"Browser/2"');
  });

  it.each([null, undefined, "", "Browser/1"])("unchanged or absent device does not write or renew: %s", async userAgent => {
    const queries = database("Browser/1");
    state.context.userAgent = userAgent;
    await createSessionStorage().touchSession("synthetic", new Date(), { ipOnly: true });
    expect(queries).toHaveLength(1);
    expect(state.emit).not.toHaveBeenCalled();
  });

  it("ignores a caller's stale reserved value and carries authoritative previous details", async () => {
    const queries = database("Browser/1");
    await createSessionStorage().upsertSession("synthetic", {
      _sessionClientUserAgent: "Stale/1", cookie: {}, applicationData: { kept: true },
    }, new Date());
    const update = queries.find(query => query.sql.startsWith("update"))!;
    const stored = JSON.parse(update.params[0] as string);
    expect(stored._sessionClientUserAgent).toBe("Browser/2");
    expect(stored.applicationData).toEqual({ kept: true });
    expect(state.emit).toHaveBeenCalledWith("session.save.after", expect.objectContaining({
      userAgent: "Browser/2", previousUserAgent: "Browser/1", userId: null,
    }));
  });

  it("a background save preserves the device already observed on the live row", async () => {
    const queries = database("Browser/1");
    state.context = {};
    await createSessionStorage().upsertSession("synthetic", { cookie: {} }, new Date());
    const update = queries.find(query => query.sql.startsWith("update"))!;
    expect(JSON.parse(update.params[0] as string)._sessionClientUserAgent).toBe("Browser/1");
    expect(state.emit).toHaveBeenCalledWith("session.save.after", expect.objectContaining({
      userAgent: "Browser/1", previousUserAgent: "Browser/1",
    }));
  });
});

describe("history sign-in metadata", () => {
  it.each([false, true])("merges device metadata alongside Clerk correlation (restored=%s)", async restored => {
    const queries: { sql: string; params: unknown[] }[] = [];
    state.client = drizzle(async (sql, params) => {
      queries.push({ sql, params });
      if (sql.startsWith("select distinct")) return { rows: [["192.0.2.1"]] };
      if (sql.startsWith("select")) return { rows: restored ? [["prior-row"]] : [] };
      return { rows: [] };
    });
    const reference = "a".repeat(64);
    const decision = await createSessionHistoryStorage().recordSignIn({
      id: "occurrence", sid: "synthetic", userId: "actual-user", ip: "192.0.2.1",
      authenticationSessionReference: reference,
      data: { device: { user_agent: "Browser/2", other: true }, extra: "kept" },
    });
    expect(decision).toEqual({
      ipDecision: restored ? "restored-session" : "known-ip",
      deviceDecision: restored ? "restored-session" : "missing-device",
    });
    const insert = queries.find(query => query.sql.startsWith("insert"))!;
    const json = insert.params.find(param => typeof param === "string" && param.startsWith("{")) as string;
    expect(JSON.parse(json)).toEqual({
      device: { user_agent: "Browser/2", other: true }, extra: "kept",
      authenticationSessionReference: reference,
    });
  });

  const firstDevice = "f865a51a-3656-4e89-bded-dd9e9da3b4c2";
  const otherDevice = "38dbe270-9156-461d-b592-8df2a332606f";
  it.each([
    { prior: [], ip: "192.0.2.1", deviceId: firstDevice, ipDecision: "baseline", deviceDecision: "baseline" },
    { prior: [["192.0.2.1", null]], ip: "192.0.2.1", deviceId: firstDevice, ipDecision: "known-ip", deviceDecision: "baseline" },
    { prior: [["192.0.2.1", null]], ip: "192.0.2.2", deviceId: firstDevice, ipDecision: "new-ip", deviceDecision: "baseline" },
    { prior: [["192.0.2.1", firstDevice]], ip: "192.0.2.1", deviceId: firstDevice, ipDecision: "known-ip", deviceDecision: "known-device" },
    { prior: [["192.0.2.1", firstDevice]], ip: "192.0.2.2", deviceId: firstDevice, ipDecision: "new-ip", deviceDecision: "known-device" },
    { prior: [["192.0.2.1", firstDevice]], ip: "192.0.2.1", deviceId: otherDevice, ipDecision: "known-ip", deviceDecision: "new-device" },
    { prior: [["192.0.2.1", firstDevice]], ip: "192.0.2.2", deviceId: otherDevice, ipDecision: "new-ip", deviceDecision: "new-device" },
    { prior: [[null, firstDevice]], ip: null, deviceId: otherDevice, ipDecision: "missing-ip", deviceDecision: "new-device" },
    { prior: [[null, firstDevice]], ip: "192.0.2.1", deviceId: otherDevice, ipDecision: "baseline", deviceDecision: "new-device" },
    { prior: [["192.0.2.1", firstDevice]], ip: "192.0.2.2", deviceId: null, ipDecision: "new-ip", deviceDecision: "missing-device" },
    { prior: [], ip: null, deviceId: null, ipDecision: "missing-ip", deviceDecision: "missing-device" },
    { prior: [["192.0.2.1", firstDevice], ["192.0.2.2", otherDevice]], ip: "192.0.2.1", deviceId: otherDevice, ipDecision: "known-ip", deviceDecision: "known-device" },
  ])("compares independently before insertion: $ipDecision / $deviceDecision", async scenario => {
    const queries: { sql: string; params: unknown[] }[] = [];
    state.client = drizzle(async (sql, params) => {
      queries.push({ sql, params });
      return { rows: sql.startsWith("select distinct") ? scenario.prior : [] };
    });
    const result = await createSessionHistoryStorage().recordSignIn({
      id: "occurrence", sid: "synthetic", userId: "actual-user",
      ip: scenario.ip, deviceId: scenario.deviceId,
    });
    expect(result).toEqual({ ipDecision: scenario.ipDecision, deviceDecision: scenario.deviceDecision });
    const comparison = queries.findIndex(query => query.sql.startsWith("select distinct"));
    const insertion = queries.findIndex(query => query.sql.startsWith("insert"));
    expect(comparison).toBeLessThan(insertion);
    expect(queries[comparison].sql).toContain('where "session_history"."user_id" = $1');
    expect(queries[comparison].params).toEqual(["actual-user"]);
    expect(queries[insertion].params).toContain(scenario.deviceId);
    expect(queries[0].sql).toContain("lock_timeout");
    expect(queries[1].sql).toContain("pg_advisory_xact_lock");
  });
});
