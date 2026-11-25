import { beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/pg-proxy";
import { getTableColumns } from "drizzle-orm";
import { users } from "../../shared/schema";

const state = vi.hoisted(() => ({
  client: undefined as any,
  rows: [] as any[],
  queries: [] as { sql: string; params: any[] }[],
  afterCommit: [] as (() => void)[],
  emit: vi.fn(),
}));
vi.mock("../../server/storage/transaction-context", () => ({
  getClient: () => state.client,
  runInTransaction: (fn: () => unknown) => fn(),
  runOutsideTransaction: (fn: () => unknown) => fn(),
  onAfterCommit: (fn: () => void) => state.afterCommit.push(fn),
}));
vi.mock("../../server/storage/maintenance", () => ({ allowInMaintenanceMode: (fn: () => unknown) => fn() }));
vi.mock("../../server/middleware/request-context", () => ({ getRequestContext: () => undefined }));
vi.mock("../../server/services/event-bus", () => ({
  eventBus: { emit: state.emit },
  EventType: { SESSION_SAVE_AFTER: "session.save.after", SESSION_DELETE_AFTER: "session.delete.after" },
  // The storage aggregate loads component event declarations; preserve their names.
  registerComponentEvent: (name: string) => name,
}));
vi.mock("../../server/logger", () => ({ logger: { error: vi.fn() } }));
import { createSessionStorage } from "../../server/storage/system/sessions";
import { createUserStorage } from "../../server/storage/users";
import { onSessionAuthorityEnded } from "../../server/auth/socket-authority";

const session = (version?: number) => ({
  passport: { user: { providerType: "local", claims: { sub: "external" }, dbUser: { id: "owner", sessionVersion: version } } },
});
beforeEach(() => {
  state.rows = [{ id: "owner", is_active: true, session_version: 0 }, { id: "target", is_active: true, session_version: 0 }];
  state.queries = [];
  state.afterCommit = [];
  state.emit.mockReset().mockResolvedValue(undefined);
  const client = drizzle(async (sql, params) => {
    state.queries.push({ sql, params });
    if (sql.includes("SELECT id, is_active")) return { rows: state.rows };
    if (sql.includes("FROM auth_identities")) return { rows: [{ user_id: "owner" }] };
    if (sql.includes("SELECT sess #>>")) return { rows: [{ old_user_id: "owner", old_sess: session(), old_ip: null }] };
    return { rows: [] };
  });
  state.client = new Proxy(client, {
    get(target, key) {
      if (key === "execute") return async (query: Parameters<typeof client.execute>[0]) => ({ rows: await target.execute(query) });
      return Reflect.get(target, key);
    },
  });
});

describe("serialized account and session writes", () => {
  it.each(["false", "true", 0, 1, null])("rejects a non-boolean account status %s before writes", async isActive => {
    await expect(createUserStorage().updateUser("owner", { isActive } as any)).rejects.toThrow("isActive must be a boolean");
    expect(state.queries).toEqual([]);
  });
  it.each(["inactive", "missing", "old-owner-generation", "old-target-generation"])(
    "refuses %s before any session update, insert or event", async refusal => {
      const sess: any = session();
      if (refusal === "inactive") state.rows[0].is_active = false;
      if (refusal === "missing") state.rows = [];
      if (refusal === "old-owner-generation") state.rows[0].session_version = 1;
      if (refusal === "old-target-generation") {
        sess.masqueradeUserId = "target";
        state.rows[1].session_version = 1;
      }
      await expect(createSessionStorage().upsertSession("late-save", sess, new Date())).rejects.toThrow("authority has ended");
      expect(state.queries.some(query => /^(insert|update)/i.test(query.sql))).toBe(false);
      expect(state.afterCommit).toEqual([]);
    },
  );
  it("accepts legacy generation zero and locks accounts before the session row", async () => {
    await createSessionStorage().upsertSession("legacy", session(), new Date());
    const account = state.queries.findIndex(query => query.sql.includes("FROM users"));
    const sessionLock = state.queries.findIndex(query => query.sql.includes("FROM sessions"));
    expect(account).toBeLessThan(sessionLock);
    expect(state.queries[account].sql).toContain("ORDER BY id FOR UPDATE");
  });
  it("allows a fresh generation while refusing old late saves after reactivation", async () => {
    state.rows[0].session_version = 2;
    await expect(createSessionStorage().upsertSession("old", session(1), new Date())).rejects.toThrow();
    await expect(createSessionStorage().upsertSession("fresh", session(2), new Date())).resolves.toMatchObject({ created: false });
  });
  it("resolves legacy provider subjects before acquiring account locks", async () => {
    const legacy = { passport: { user: { providerType: "saml", claims: { sub: "external-subject" } } } };
    await createSessionStorage().upsertSession("legacy", legacy, new Date());
    expect(state.queries[0].params).toEqual(["saml", "external-subject"]);
    expect(state.queries[1].params).toEqual(["owner", "owner"]);
  });
  it("deactivation advances authority and revokes selected sessions with after-commit invalidation", async () => {
    const closed = vi.fn();
    const unsubscribe = onSessionAuthorityEnded("owned-session", closed);
    const user: any = { id: "owner", email: "test@example.invalid", isActive: false, sessionVersion: 1 };
    const values = Object.keys(getTableColumns(users)).map(key => user[key] ?? null);
    const client = drizzle(async (sql, params) => {
      state.queries.push({ sql, params });
      if (sql.includes("SELECT sid FROM sessions")) return { rows: [{ sid: "owned-session" }, { sid: "masquerade-session" }] };
      if (sql.startsWith("delete")) return { rows: [[session()]] };
      return { rows: [values] };
    });
    state.client = new Proxy(client, {
      get(target, key) {
        if (key === "execute") return async (query: Parameters<typeof client.execute>[0]) => ({ rows: await target.execute(query) });
        return Reflect.get(target, key);
      },
    });
    expect((await createUserStorage().updateUser("owner", { isActive: false }))?.sessionVersion).toBe(1);
    const update = state.queries.find(query => query.sql.startsWith("update"))!;
    expect(update.sql).toContain('"session_version" = "users"."session_version" + 1');
    const selection = state.queries.find(query => query.sql.includes("SELECT sid"))!;
    expect(selection.sql).toContain("masqueradeUserId");
    expect(selection.sql).toContain("originalUserId");
    expect(selection.sql).toContain("a.provider_type::text");
    expect(selection.sql).toContain("a.external_id");
    expect(selection.sql).not.toContain("'{passport,user,claims,sub}' =");
    expect(state.queries.filter(query => query.sql.startsWith("delete"))).toHaveLength(2);
    expect(closed).not.toHaveBeenCalled();
    for (const callback of state.afterCommit) callback();
    expect(closed).toHaveBeenCalledOnce();
    unsubscribe();
  });
});
