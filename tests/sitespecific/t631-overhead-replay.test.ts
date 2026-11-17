// Controlled synthetic replay. No application tables or vendor traffic.
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { sql, eq } from "drizzle-orm";

const fixture = vi.hoisted(() => ({
  schema: `test_t631_overhead_${process.pid}`,
  queries: 0, locks: 0,
}));
vi.mock("@shared/schema", async () => {
  const { pgSchema, text } = await import("drizzle-orm/pg-core");
  const s = pgSchema(fixture.schema);
  return {
    workers: s.table("workers", { id: text("id").primaryKey(), contactId: text("contact_id") }),
    workerIds: s.table("worker_ids", {
      id: text("id").primaryKey(), workerId: text("worker_id"), typeId: text("type_id"), value: text("value"),
    }),
    optionsWorkerIdType: s.table("types", { id: text("id"), siriusId: text("sirius_id") }),
  };
});
vi.mock("../../server/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() }, storageLogger: { info: vi.fn() } }));
vi.mock("../../server/services/comm/validators/phone", () => ({ schedulePhoneRevalidation: vi.fn() }));
vi.mock("../../server/modules/options-registry", () => ({ getOptionsType: () => ({ getAll: async () => [] }) }));
vi.mock("../../server/storage", () => ({
  createCommSmsOptinStorage: () => ({}),
  storage: {
    get workerIds() { return ids; },
    variables: { getByName: async () => null },
    workers: {
      getWorker: async (id: string) => {
        const [worker] = await getClient().select().from(workers).where(eq(workers.id, id));
        // Production hydration performs three additional denorm reads.
        for (let n = 0; n < 3; n++) await getClient().execute(sql`SELECT 1`);
        return worker;
      },
      getWorkerContactId: async (id: string) => (await getClient().select().from(workers).where(eq(workers.id, id)))[0]?.contactId,
    },
    contacts: { phoneNumbers: { getPhoneNumbersByContact: async () => {
      await getClient().execute(sql`SELECT 1`); return [];
    } } },
  },
}));
vi.mock("../../server/storage/database", () => ({ storage: { workerIds: {
  createWorkerId: async (row: any) => {
    return ids.createWorkerId(row);
  },
  deleteWorkerId: async (id: string) => {
    return ids.deleteWorkerId(id);
  },
} } }));
import { db, pool } from "../../server/storage/db";
import { getClient, runInTransaction } from "../../server/storage/transaction-context";
import { workers, workerIds } from "@shared/schema";
import { createWorkerIdStorage } from "../../server/storage/workers/ids";
import { syncWorkerEins } from "../../server/modules/sitespecific/t631/client/sync-workers";
const ids = createWorkerIdStorage();
// Kept small for normal regression runs; measurements in docs used 200.
const count = 4;
beforeAll(async () => {
  // Instrument only this isolated process; never log query text or parameters.
  pool.on("connect", (client: any) => {
    const query = client.query.bind(client);
    client.query = (...args: any[]) => {
      fixture.queries++;
      const text = typeof args[0] === "string" ? args[0] : args[0]?.text ?? "";
      const lock = text.startsWith("LOCK TABLE");
      if (lock) fixture.locks++;
      return query(...args);
    };
  });
  await db.execute(sql.raw(`CREATE SCHEMA "${fixture.schema}";
    CREATE TABLE "${fixture.schema}".workers (id text PRIMARY KEY, contact_id text);
    CREATE TABLE "${fixture.schema}".worker_ids (id text PRIMARY KEY DEFAULT gen_random_uuid()::text, worker_id text, type_id text, value text);
    CREATE INDEX ON "${fixture.schema}".worker_ids(type_id,value);
    CREATE INDEX ON "${fixture.schema}".worker_ids(worker_id);
    CREATE TABLE "${fixture.schema}".types (id text, sirius_id text);
    INSERT INTO "${fixture.schema}".types VALUES ('t631','t631'),('freeman_ein','freeman_ein');
    INSERT INTO "${fixture.schema}".workers SELECT 'w'||n,'c'||n FROM generate_series(1,${count}) n;
    INSERT INTO "${fixture.schema}".worker_ids SELECT 's'||n,'w'||n,'t631',n::text FROM generate_series(1,${count}) n;
    INSERT INTO "${fixture.schema}".worker_ids SELECT 'e'||n,'w'||n,'freeman_ein','ein'||n FROM generate_series(1,${count}) n;`));
});
afterAll(async () => {
  await db.execute(sql.raw(`DROP SCHEMA "${fixture.schema}" CASCADE`));
  await pool.end();
});
it("reuses locked reads without changing unchanged/changed reconciliation results", async () => {
  for (const changed of [false, true]) {
    const body = JSON.stringify({ success: true, data: { workers: Array.from({ length: count }, (_, i) => ({
      worker_id: `I${i + 1}`, worker_ein: `${changed ? "new" : "ein"}${i + 1}`, worker_phone: "",
    })) } });
    const payload = JSON.parse(body);
    fixture.queries = fixture.locks = 0;
    const result = await syncWorkerEins(payload, false, work => runInTransaction(async () => {
      // Same per-unit round trips as the durable execution fence/status check.
      await getClient().execute(sql`SELECT pg_advisory_xact_lock(2032099)`);
      await getClient().execute(sql`SELECT 1`);
      await work();
    }));
    expect(result.errors).toBe(0);
    expect(changed ? result.updated : result.unchanged).toBe(count);
    expect(result.rowCounts).toEqual({ received: count, changed: changed ? count : 0, unchanged: changed ? 0 : count });
    expect(fixture.locks).toBe(count);
  }
});

it("invalidates cached holders and aliases on every public ID mutation", async () => {
  await ids.withLockedIdentityReads(async () => {
    expect(await ids.getWorkerIdByTypeAndValue("extra", "first")).toBeUndefined();
    const created = await ids.createWorkerId({ workerId: "w1", typeId: "extra", value: "first" });
    expect(await ids.getWorkerIdByTypeAndValue("extra", "first")).toMatchObject({ id: created.id });
    expect(await ids.getByTypeAndValues("extra", ["first"])).toHaveLength(1);
    await ids.updateWorkerId(created.id, { value: "second" });
    expect(await ids.getByTypeAndValues("extra", ["first"])).toHaveLength(0);
    expect(await ids.getWorkerIdByTypeAndValue("extra", "second")).toMatchObject({ id: created.id });
    await ids.deleteWorkerId(created.id);
    expect(await ids.getWorkerIdByTypeAndValue("extra", "second")).toBeUndefined();
  });
});

it("blocks a direct SQL writer through the whole unit, then reads its committed change", async () => {
  let writer: Promise<unknown> | undefined;
  let completed = false;
  await ids.withLockedIdentityReads(async () => {
    expect(await ids.getByTypeAndValues("t631", ["1"])).toHaveLength(1);
    // Separate pool connection, not a cooperating advisory-lock client.
    writer = Promise.resolve(db.execute(sql`UPDATE ${workerIds} SET value = '9001' WHERE id = 's1'`))
      .then(() => { completed = true; });
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(completed).toBe(false);
    expect(await ids.getByTypeAndValues("t631", ["1"])).toHaveLength(1);
    // This represents later phone/status work in the same transaction.
    await getClient().execute(sql`SELECT 1`);
    expect(completed).toBe(false);
  });
  await writer;
  await ids.withLockedIdentityReads(async () => {
    expect(await ids.getByTypeAndValues("t631", ["1"])).toHaveLength(0);
    expect(await ids.getByTypeAndValues("t631", ["9001"])).toHaveLength(1);
  });
});

it("discards a failed unit's mutations and cached reads", async () => {
  await expect(ids.withLockedIdentityReads(async () => {
    await ids.getWorkerIdByTypeAndValue("t631", "2");
    await ids.updateWorkerId("s2", { value: "9002" });
    expect(await ids.getWorkerIdByTypeAndValue("t631", "9002")).toBeDefined();
    throw new Error("stop unit");
  })).rejects.toThrow("stop unit");
  await ids.withLockedIdentityReads(async () => {
    expect(await ids.getWorkerIdByTypeAndValue("t631", "2")).toBeDefined();
    expect(await ids.getWorkerIdByTypeAndValue("t631", "9002")).toBeUndefined();
  });
});
