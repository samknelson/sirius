import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { and, eq, ne, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { CronPlugin } from "../../../../server/plugins/system/cron/types";

// Real lease, scheduler, plugin and business transactions. Isolated schema,
// fake vendor/reconciliation: never changes application workers or semaphores.
const fixture = vi.hoisted(() => ({
  schema: `test_t631_cron_${process.pid}`, fetch: vi.fn(), sync: vi.fn(),
  enabled: true, plugin: undefined as CronPlugin | undefined,
}));
vi.mock("../../../../server/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock("../../../../server/storage/db", async importOriginal => {
  const actual = await importOriginal<typeof import("../../../../server/storage/db")>();
  const { Pool } = await import("pg");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const pool = new Pool({ ...actual.pool.options, options: `-c search_path=${fixture.schema}` });
  return { ...actual, pool, db: drizzle(pool) };
});
vi.mock("@shared/schema", async () => {
  const { pgSchema, varchar, text, timestamp } = await import("drizzle-orm/pg-core");
  const { sql } = await import("drizzle-orm");
  return { jobRuns: pgSchema(fixture.schema).table("job_runs", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    configurationId: varchar("configuration_id"), pluginKind: varchar("plugin_kind"), pluginId: text("plugin_id"),
    operation: varchar("operation"), status: varchar("status"), mode: varchar("mode"),
    output: text("output"), error: text("error"), triggeredBy: varchar("triggered_by"),
    completedAt: timestamp("completed_at"), startedAt: timestamp("started_at").defaultNow(),
  }) };
});
vi.mock("../../../../server/modules/components", () => ({
  isComponentEnabled: async () => fixture.enabled,
  getEnabledComponentIds: async () => fixture.enabled ? ["edls", "sitespecific.t631.client"] : [],
}));
vi.mock("../../server/modules/sitespecific/t631/client/fetch", () => ({
  t631Fetch: fixture.fetch, isT631ConfigurationError: (e: any) => e?.name === "ConfigError",
}));
vi.mock("../../../../server/services/worker-sync", () => ({
  syncWorkerEins: fixture.sync, SyncInterrupted: class extends Error {}, SyncRunRefusal: class extends Error {},
}));
vi.mock("../../../../server/plugins/system/cron/registry", () => ({
  registerCronPlugin: (plugin: CronPlugin) => { fixture.plugin = plugin; },
  cronPluginRegistry: { has: () => true, get: () => fixture.plugin },
  executeCronPlugin: async (_name: string, context: Parameters<CronPlugin["execute"]>[0], assertOwned: () => void) => {
    assertOwned(); const result = await fixture.plugin!.execute(context); assertOwned(); return result;
  },
}));
vi.mock("../../../../server/storage/configuration-revisions", () => ({ readConfigurationSnapshot: (fn: () => unknown) => fn() }));
vi.mock("../../../../server/storage", () => ({ storage: {
  pluginConfigs: { getWithSubsidiary: async (id: string) => ({
    config: { id, pluginKind: "cron", pluginId: "sitespecific-t631-worker-fetch", enabled: true, data: {} },
    subsidiary: { schedule: "0 9 * * *" },
  }) },
  jobRuns: {
    create: async (data: any, client?: any) =>
      (await (client ? drizzle(client) : getClient()).insert(jobRuns).values(data).returning())[0],
    getById: async (id: string) => (await getClient().select().from(jobRuns).where(eq(jobRuns.id, id)))[0],
    update: async (id: string, data: any, client: any) =>
      (await drizzle(client).update(jobRuns).set(data).where(and(eq(jobRuns.id, id), eq(jobRuns.status, "running"))).returning())[0],
    interruptAbandonedCronRuns: async (plugin: string, id: string, client: any) =>
      (await drizzle(client).update(jobRuns).set({ status: "interrupted" }).where(and(
        eq(jobRuns.pluginKind, "cron"), eq(jobRuns.pluginId, plugin), eq(jobRuns.status, "running"), ne(jobRuns.id, id),
      )).returning()).length,
    interruptIfRunning: async (id: string, error: string) =>
      db.update(jobRuns).set({ status: "interrupted", error }).where(and(eq(jobRuns.id, id), eq(jobRuns.status, "running"))),
  },
} }));

import { db, pool } from "../../../../server/storage/db";
import { getClient, onAfterCommit, runInTransaction } from "../../../../server/storage/transaction-context";
import { requestContext } from "../../../../server/middleware/request-context";
import { setMaintenanceActive } from "../../../../server/services/maintenance-flag";
import { semaphoreStorage } from "../../../../server/storage/system/semaphores";
import { CronScheduler } from "../../../../server/plugins/system/cron/scheduler";
import { jobRuns } from "@shared/schema";
import "../../server/plugins/system/cron/plugins/t631WorkerFetch";

const KEY = "cron:execution:sitespecific-t631-worker-fetch";
const result = {
  rowCounts: { received: 1, changed: 1, unchanged: 0 },
  created: 1, updated: 2, deleted: 3, unchanged: 4, skipped: 5, errors: 0,
  workersCreated: 6, phonesCreated: 7, phonesDeleted: 8, phonesUnchanged: 9,
  optins: 10, statusesSet: 11, edlsActivated: 12, edlsDeactivated: 13,
  details: [{ remoteWorkerId: "fixture", action: "created" }],
};
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
}
let scheduler: CronScheduler;
const run = (mode: "live" | "test" = "live", actor = "actor", config = "config") => scheduler.manualRun(config, actor, mode);
const read = async (id: string) => (await db.select().from(jobRuns).where(eq(jobRuns.id, id)))[0];
beforeAll(async () => {
  await db.execute(sql.raw(`CREATE SCHEMA "${fixture.schema}";
    CREATE TABLE "${fixture.schema}".job_runs (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(), configuration_id varchar,
      plugin_kind varchar, plugin_id text, operation varchar, status varchar, mode varchar,
      output text, error text, triggered_by varchar, completed_at timestamp, started_at timestamp DEFAULT now());
    CREATE TABLE "${fixture.schema}".semaphores (
      key text PRIMARY KEY, owner_process_id uuid, ownership_token uuid, expires_at timestamptz);
    CREATE TABLE "${fixture.schema}".mutations (value text)`));
});
beforeEach(async () => {
  setMaintenanceActive(false); fixture.enabled = true;
  fixture.fetch.mockReset().mockResolvedValue({ success: true, data: { success: true, data: { workers: [] } } });
  fixture.sync.mockReset().mockResolvedValue(result);
  await db.execute(sql`TRUNCATE job_runs, semaphores, mutations`);
  scheduler = new CronScheduler();
});
afterEach(async () => { await scheduler.stop(); vi.restoreAllMocks(); vi.useRealTimers(); });
afterAll(async () => {
  setMaintenanceActive(false);
  await db.execute(sql.raw(`DROP SCHEMA IF EXISTS "${fixture.schema}" CASCADE`)); await pool.end();
});

it.each(["test", "live"] as const)("uses one cron lease/history and retains the complete %s result", async mode => {
  const id = await run(mode);
  const history = await read(id);
  expect(history).toMatchObject({ pluginKind: "cron", mode, status: "success", triggeredBy: "actor" });
  expect(JSON.parse(history.output!).summary.metadata).toEqual({ dryRun: mode === "test", ...result });
  expect((await db.select().from(jobRuns))).toHaveLength(1);
  expect((await db.execute(sql`SELECT key FROM semaphores`)).rows).toEqual([{ key: KEY }]);
  expect(fixture.sync).toHaveBeenCalledWith(expect.anything(), mode === "test", expect.any(Function));
});

it("shares manual/scheduled and test/live exclusion across configurations", async () => {
  const entered = deferred(), finish = deferred();
  fixture.fetch.mockImplementation(async () => {
    entered.resolve(); await finish.promise; return { success: true, data: { success: true, data: { workers: [] } } };
  });
  const manual = run(); await entered.promise;
  try {
    const skipped = await scheduler.executeJob({
      configurationId: "other", name: "sitespecific-t631-worker-fetch", enabled: true, schedule: "0 9 * * *", settings: {},
    }, false, undefined, "test");
    expect((await read(skipped)).status).toBe("skipped");
    expect(fixture.fetch).toHaveBeenCalledOnce();
    expect(fixture.sync).not.toHaveBeenCalled();
  } finally { finish.resolve(); await manual; }
});

it("fences an expired worker transaction until rollback before recovery/new mutations", async () => {
  const entered = deferred(), finish = deferred(), oldDone = deferred();
  const committed = vi.fn();
  let secondMutation = false;
  fixture.sync.mockImplementationOnce(async (_data, _dry, unit) => {
    await db.execute(sql`UPDATE semaphores SET expires_at = clock_timestamp() + interval '150 milliseconds' WHERE key = ${KEY}`);
    try {
      await unit(async () => {
        onAfterCommit(committed);
        await getClient().execute(sql`INSERT INTO mutations VALUES ('old')`);
        entered.resolve(); await finish.promise;
      });
      await unit(async () => { secondMutation = true; });
      return result;
    } finally { oldDone.resolve(); }
  });
  const old = run(); await entered.promise;
  await new Promise(r => setTimeout(r, 180));
  let admitted = false;
  const successor = run("test").then(id => { admitted = true; return id; });
  try {
    await new Promise(r => setTimeout(r, 40));
    expect(admitted).toBe(false);
    expect((await db.execute(sql`SELECT * FROM mutations`)).rowCount).toBe(0);
  } finally { finish.resolve(); }
  await oldDone.promise;
  expect((await read(await old)).status).toBe("interrupted");
  expect((await read(await successor)).status).toBe("success");
  expect(secondMutation).toBe(false); expect(committed).not.toHaveBeenCalled();
  expect((await db.execute(sql`SELECT * FROM mutations`)).rowCount).toBe(0);
});

it("discards a late fetch after ambiguous renewal and never begins reconciliation", async () => {
  const entered = deferred(), finish = deferred(), responded = deferred();
  fixture.fetch.mockImplementation(async () => {
    entered.resolve(); await finish.promise; responded.resolve();
    return { success: true, data: { success: true, data: { workers: [] } } };
  });
  vi.spyOn(semaphoreStorage, "renew").mockRejectedValue(new Error("uncertain"));
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const waiting = run(); await entered.promise;
  await vi.advanceTimersByTimeAsync(5000);
  const id = await waiting;
  expect((await read(id)).status).toBe("interrupted");
  vi.useRealTimers(); finish.resolve(); await responded.promise;
  await new Promise(r => setTimeout(r, 30));
  expect(fixture.sync).not.toHaveBeenCalled();
  expect((await read(id)).status).toBe("interrupted");
});

it("rejects a superseded executor's late result without changing successor history", async () => {
  const entered = deferred(), finish = deferred();
  fixture.sync.mockImplementationOnce(async () => { entered.resolve(); await finish.promise; return result; });
  const old = run(); await entered.promise;
  await db.execute(sql`UPDATE semaphores SET expires_at = clock_timestamp() - interval '1 second' WHERE key = ${KEY}`);
  const replacementId = await run("test");
  expect((await read(replacementId)).status).toBe("success");
  finish.resolve();
  expect((await read(await old)).status).toBe("interrupted");
  expect((await read(replacementId)).status).toBe("success");
});

it("refuses worker mutations when its exact cron run is no longer running", async () => {
  let mutation = false;
  fixture.sync.mockImplementationOnce(async (_data, _dry, unit) => {
    await db.update(jobRuns).set({ status: "interrupted" }).where(eq(jobRuns.pluginKind, "cron"));
    await unit(async () => { mutation = true; }); return result;
  });
  expect((await read(await run())).status).toBe("interrupted");
  expect(mutation).toBe(false);
});

it("rolls back timed-out worker SQL and allows a fresh run without replay", async () => {
  const committed = vi.fn();
  fixture.sync.mockImplementationOnce(async (_data, _dry, unit) => {
    await unit(async () => {
      const settings = await getClient().execute(sql`SELECT current_setting('statement_timeout') AS statement,
        current_setting('idle_in_transaction_session_timeout') AS idle`);
      expect(settings.rows[0]).toEqual({ statement: "1min", idle: "15s" });
      onAfterCommit(committed);
      await getClient().execute(sql`INSERT INTO mutations VALUES ('rollback')`);
      await getClient().execute(sql`SET LOCAL statement_timeout = '100ms'`);
      await getClient().execute(sql`SELECT pg_sleep(5)`);
    });
    return result;
  });
  expect((await read(await run())).status).toBe("interrupted");
  expect(committed).not.toHaveBeenCalled();
  expect((await db.execute(sql`SELECT * FROM mutations`)).rowCount).toBe(0);
  expect((await read(await run())).status).toBe("success");
  expect(fixture.sync).toHaveBeenCalledTimes(2);
});

it.each(["idle", "terminated"])("rejects late worker writes after a %s connection", async mode => {
  const entered = deferred(), resume = deferred(), done = deferred();
  const committed = vi.fn();
  let pid = 0, lateError: unknown;
  fixture.sync.mockImplementationOnce(async (_data, _dry, unit) => {
    await unit(async () => {
      onAfterCommit(committed);
      await getClient().execute(sql`INSERT INTO mutations VALUES ('rollback')`);
      pid = Number((await getClient().execute(sql`SELECT pg_backend_pid() AS pid`)).rows[0].pid);
      if (mode === "idle") await getClient().execute(sql`SET LOCAL idle_in_transaction_session_timeout = '150ms'`);
      entered.resolve(); await resume.promise;
      try { await getClient().execute(sql`INSERT INTO mutations VALUES ('late')`); }
      catch (e) { lateError = e; throw e; }
      finally { done.resolve(); }
    }); return result;
  });
  const running = run(); await entered.promise;
  if (mode === "terminated") await db.execute(sql`SELECT pg_terminate_backend(${pid})`);
  expect((await read(await running)).status).toBe("interrupted");
  expect((await read(await run("test"))).status).toBe("success");
  resume.resolve(); await done.promise;
  expect(lateError).toBeDefined(); expect(committed).not.toHaveBeenCalled();
  expect((await db.execute(sql`SELECT * FROM mutations`)).rowCount).toBe(0);
});

it.each([
  ["remote", { success: false }, undefined, "Remote failure"],
  ["invalid payload", { success: true, data: { success: true, data: {} } }, undefined, "Remote failure"],
  ["configuration", undefined, Object.assign(new Error("sensitive"), { name: "ConfigError" }), "Configuration refusal"],
] as const)("records sanitized %s failures", async (_name, value, error, message) => {
  if (error) fixture.fetch.mockRejectedValue(error); else fixture.fetch.mockResolvedValue(value);
  await expect(run()).rejects.toThrow(message);
  const [history] = await db.select().from(jobRuns);
  expect(history.status).toBe("error"); expect(history.error).not.toContain("sensitive");
  expect(fixture.sync).not.toHaveBeenCalled();
});

it("keeps effective-actor attribution and detaches worker units from request transactions", async () => {
  const committed = vi.fn();
  fixture.sync.mockImplementationOnce(async (_data, _dry, unit) => {
    await unit(async () => {
      expect(requestContext.getStore()?.userId).toBe("effective");
      await getClient().execute(sql`INSERT INTO mutations VALUES ('effective')`);
      onAfterCommit(committed);
    }); return result;
  });
  const id = await runInTransaction(async () => {
    await getClient().execute(sql`SET LOCAL transaction_read_only = on`);
    return run("live", "effective");
  });
  expect((await read(id)).status).toBe("success");
  expect((await read(id)).triggeredBy).toBe("effective");
  expect(committed).toHaveBeenCalledOnce();
});

it("preserves old T631 history and checks maintenance/components at worker boundaries", async () => {
  const [old] = await db.insert(jobRuns).values({
    pluginKind: "t631-sync", pluginId: "sitespecific-t631-worker-fetch", status: "success", output: "old result",
  }).returning();
  fixture.sync.mockImplementationOnce(async (_data, _dry, unit) => {
    setMaintenanceActive(true); await unit(async () => { throw new Error("must not run"); }); return result;
  });
  await expect(run()).rejects.toThrow("Maintenance refusal");
  setMaintenanceActive(false);
  fixture.sync.mockImplementationOnce(async (_data, _dry, unit) => {
    fixture.enabled = false; await unit(async () => { throw new Error("must not run"); }); return result;
  });
  await expect(run()).rejects.toThrow("Configuration refusal");
  expect(await read(old.id)).toMatchObject({ status: "success", output: "old result" });
});
