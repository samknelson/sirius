import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { readMaskState } from "../../shared/privacy/mask-mode";

const fake = vi.hoisted(() => ({
  rows: new Map<string, any>(), sql: [] as string[], audit: [] as any[],
  callbacks: [] as Array<() => void>, tail: Promise.resolve(), client: undefined as any,
}));
vi.mock("../../server/storage/db", () => ({
  pool: {}, getPresentationLeasePool: () => ({}),
}));
vi.mock("../../server/storage/system/mask-component", () => ({
  lockMaskComponent: async () => {},
  readMaskComponent: async () => ({ enabled: true, epoch: "fixture-epoch" }),
}));
vi.mock("../../server/logger", () => ({
  storageLogger: { info: (...args: any[]) => fake.audit.push(args) },
  logger: { info() {}, warn() {}, error() {} },
}));
vi.mock("../../server/storage/maintenance", () => ({
  allowInMaintenanceMode: (fn: () => Promise<unknown>) => fn(),
}));
vi.mock("../../server/storage/transaction-context", () => ({
  getClient: () => fake.client,
  onAfterCommit: (fn: () => void) => fake.callbacks.push(fn),
  runInTransaction: async (fn: () => Promise<unknown>) => {
    const before = fake.tail;
    let unlock!: () => void;
    fake.tail = new Promise<void>(resolve => { unlock = resolve; });
    await before;
    fake.callbacks = [];
    try {
      const result = await fn();
      fake.callbacks.forEach(callback => callback());
      return result;
    } finally { fake.callbacks = []; unlock(); }
  },
}));
import { createSessionStorage } from "../../server/storage/system/sessions";

const dialect = new PgDialect();
const session = () => ({ passport: { user: { dbUser: { id: "fictional-presenter" } } } });
const expire = new Date("2099-01-01");
beforeEach(() => {
  fake.rows.clear(); fake.audit = []; fake.sql = [];
  fake.client = {
    async execute(statement: any) {
      const query = dialect.sqlToQuery(statement);
      fake.sql.push(query.sql);
      const row = fake.rows.get(String(query.params[0]));
      if (!row || (/expire >/.test(query.sql) && row.expired)) return { rows: [] };
      return { rows: [{ sess: structuredClone(row.sess),
        prior_payload: structuredClone(row.sess),
        old_user_id: row.sess.passport?.user?.dbUser?.id }] };
    },
    update() {
      return { set(values: any) {
        return { async where(condition: any) {
          const sid = String(dialect.sqlToQuery(condition).params[0]);
          const row = fake.rows.get(sid);
          const payload = values.sess?.queryChunks
            ? { ...row.sess, maskMode: JSON.parse(String(dialect.sqlToQuery(values.sess).params[0])) }
            : structuredClone(values.sess);
          fake.rows.set(sid, { ...row, sess: payload, expire: values.expire ?? row.expire });
        } };
      } };
    },
    insert() {
      return { values(row: any) {
        return { onConflictDoNothing() {
          return { async returning() {
            if (fake.rows.has(row.sid)) return [];
            fake.rows.set(row.sid, structuredClone(row));
            return [{ sid: row.sid }];
          } };
        } };
      } };
    },
  };
});

describe("actual session storage methods, SQL/CAS and preservation contracts", () => {
  it("initializes OFF only on a newly authenticated SID, not anonymous/legacy saves", async () => {
    const storage = createSessionStorage();
    await storage.upsertSession("new", session(), expire);
    expect(fake.rows.get("new").sess.maskMode).toEqual({ version: 1, mode: "off", revision: 1 });
    await storage.upsertSession("anonymous", { maskMode: { version: 1, mode: "off", revision: 10 } }, expire);
    expect(fake.rows.get("anonymous").sess.maskMode).toBeUndefined();
    fake.rows.set("legacy", { sess: session(), expire });
    await storage.upsertSession("legacy", { ...session(), maskMode: { mode: "off", revision: 1 } }, expire);
    expect(readMaskState(fake.rows.get("legacy").sess.maskMode).mode).toBe("unknown");
  });
  it("serializes competing compare-and-set transitions and preserves ON across stale passport/rolling saves", async () => {
    const storage = createSessionStorage();
    await storage.upsertSession("sid", session(), expire);
    const stale = structuredClone(fake.rows.get("sid").sess);
    const results = await Promise.all([
      storage.transitionMaskMode("sid", 1, "on"),
      storage.transitionMaskMode("sid", 1, "off"),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(fake.rows.get("sid").sess.maskMode).toEqual({ version: 1, mode: "on", revision: 2 });
    await storage.upsertSession("sid", { ...stale, refreshedCredential: "fictional-canary" }, expire);
    expect(fake.rows.get("sid").sess.maskMode.mode).toBe("on");
    expect(fake.rows.get("sid").sess.refreshedCredential).toBe("fictional-canary");
    expect(fake.sql.filter(sql => sql.includes("FOR UPDATE")).length).toBeGreaterThan(2);
    expect(fake.audit).toHaveLength(1);
    expect(JSON.stringify(fake.audit)).not.toContain("fictional-canary");
  });
  it("keeps mode and advances generation through masquerade start/stop and attributes its audit honestly", async () => {
    const storage = createSessionStorage();
    await storage.upsertSession("sid", session(), expire);
    await storage.transitionMaskMode("sid", 1, "on");
    await storage.upsertSession("sid", { ...session(), masqueradeUserId: "fictional-target" }, expire);
    expect(fake.rows.get("sid").sess.maskMode).toEqual({ version: 1, mode: "on", revision: 3 });
    await storage.transitionMaskMode("sid", 3, "on");
    const audit = fake.audit.at(-1)[1];
    expect(audit.user_id).toBe("fictional-target");
    expect(audit.meta.masqueradedBy).toBe("fictional-presenter");
    await storage.upsertSession("sid", session(), expire);
    expect(fake.rows.get("sid").sess.maskMode).toEqual({ version: 1, mode: "on", revision: 5 });
  });
  it("will not resurrect a missing or expired session or emit an audit for a refusal", async () => {
    const storage = createSessionStorage();
    expect(await storage.transitionMaskMode("missing", 0, "off")).toBeNull();
    fake.rows.set("expired", { sess: session(), expire, expired: true });
    expect(await storage.transitionMaskMode("expired", 0, "off")).toBeNull();
    expect(fake.audit).toHaveLength(0);
    await expect(storage.upsertSession("missing", session(), expire, true)).rejects.toThrow("Session ended");
    expect(fake.rows.has("missing")).toBe(false);
  });
});
