import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";

// Real Postgres exclusion/transaction tests, isolated from application run rows
// and workers. No vendor request or reconciliation touches real worker data.
const fixture = vi.hoisted(() => ({
  table: `test_t631_runs_${process.pid}`,
  fetch: vi.fn(), sync: vi.fn(), enabled: true,
}));
vi.mock("../../server/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
// Both raw coordination and ambient Drizzle work use an isolated search_path.
// No test ever claims, expires or releases the application's semaphore.
vi.mock("../../server/storage/db", async importOriginal => {
  const actual = await importOriginal<typeof import("../../server/storage/db")>();
  const { Pool } = await import("pg");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const pool = new Pool({ ...actual.pool.options, options: `-c search_path=${fixture.table}` });
  return { ...actual, pool, db: drizzle(pool) };
});
vi.mock("@shared/schema", async () => {
  const { pgSchema, varchar, text, timestamp, boolean, jsonb } = await import("drizzle-orm/pg-core");
  const { sql } = await import("drizzle-orm");
  return { jobRuns: pgSchema(fixture.table).table("job_runs", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    pluginKind: varchar("plugin_kind"), pluginId: text("plugin_id"),
    operation: varchar("operation"), status: varchar("status"), mode: varchar("mode"),
    output: text("output"), error: text("error"), triggeredBy: varchar("triggered_by"),
    heartbeatAt: timestamp("heartbeat_at"), completedAt: timestamp("completed_at"),
    startedAt: timestamp("started_at").defaultNow(),
    checkpoint: jsonb("checkpoint"), cancelRequested: boolean("cancel_requested").default(false),
  }) };
});
vi.mock("../../server/modules/components", () => ({ isComponentEnabled: async () => fixture.enabled }));
vi.mock("../../server/modules/sitespecific/t631/client/fetch", () => ({
  t631Fetch: fixture.fetch,
  isT631ConfigurationError: (e: any) => e?.name === "ConfigError",
}));
vi.mock("../../server/modules/sitespecific/t631/client/sync-workers", () => ({
  syncWorkerEins: fixture.sync,
  SyncInterrupted: class extends Error {},
  SyncRunRefusal: class extends Error {},
}));

import { db, pool } from "../../server/storage/db";
import { getClient, onAfterCommit, runInTransaction } from "../../server/storage/transaction-context";
import { requestContext } from "../../server/middleware/request-context";
import { setMaintenanceActive } from "../../server/services/maintenance-flag";
import { startT631Run, readT631Run, publicT631Run, T631_RESOURCE } from "../../server/services/t631-sync-runs";
import { semaphoreStorage } from "../../server/storage/system/semaphores";
import { SyncInterrupted } from "../../server/modules/sitespecific/t631/client/sync-workers";
import { jobRuns } from "@shared/schema";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
}
async function terminal(id: string) {
  let run;
  for (let attempt = 0; attempt < 100; attempt++) {
    run = await readT631Run(id);
    if (run?.status !== "running") return run!;
    await new Promise(r => setTimeout(r, 20));
  }
  throw new Error("Run did not become terminal");
}
const result = { created: 1, details: Array.from({ length: 2000 }, (_, n) => ({ remoteWorkerId: `${n}`, action: "kept" })) };

beforeAll(async () => {
  await db.execute(sql.raw(`CREATE SCHEMA "${fixture.table}"`));
  await db.execute(sql.raw(`CREATE TABLE "${fixture.table}".job_runs (
    id varchar PRIMARY KEY DEFAULT gen_random_uuid(), plugin_kind varchar, plugin_id text,
    operation varchar, status varchar, mode varchar, output text, error text, triggered_by varchar,
    heartbeat_at timestamp, completed_at timestamp, started_at timestamp DEFAULT now(),
    checkpoint jsonb, cancel_requested boolean DEFAULT false)`));
  await db.execute(sql.raw(`CREATE TABLE "${fixture.table}".semaphores (
    key text PRIMARY KEY, owner_process_id uuid, ownership_token uuid, expires_at timestamptz);
    CREATE TABLE "${fixture.table}".mutations (value text)`));
});
beforeEach(async () => {
  setMaintenanceActive(false);
  fixture.enabled = true;
  fixture.fetch.mockReset().mockResolvedValue({ success: true, data: { success: true, data: { workers: [] } } });
  fixture.sync.mockReset().mockResolvedValue(result);
  await db.delete(jobRuns);
  await db.execute(sql`TRUNCATE semaphores, mutations`);
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
afterAll(async () => {
  setMaintenanceActive(false);
  vi.restoreAllMocks();
  await db.execute(sql.raw(`DROP SCHEMA IF EXISTS "${fixture.table}" CASCADE`));
  await pool.end();
});

describe("durable T631 execution", () => {
  it("interrupts timed-out worker SQL, rolls back effects, and permits fenced recovery", async () => {
    const committed = vi.fn();
    fixture.sync.mockImplementation(async (_data, _dry, unit) => {
      await expect(unit(async () => {
        const settings = await getClient().execute(sql`SELECT
          current_setting('statement_timeout') AS statement,
          current_setting('idle_in_transaction_session_timeout') AS idle`);
        expect(settings.rows[0]).toEqual({ statement: "1min", idle: "15s" });
        onAfterCommit(committed);
        await getClient().execute(sql`INSERT INTO mutations VALUES ('rolled back')`);
        await getClient().execute(sql`SET LOCAL statement_timeout = '100ms'`);
        await getClient().execute(sql`SELECT pg_sleep(5)`);
      })).rejects.toBeInstanceOf(SyncInterrupted);
      throw new SyncInterrupted();
    });
    const accepted = await startT631Run(false, "actor", true);
    expect(accepted.run.status).toBe("interrupted");
    expect(committed).not.toHaveBeenCalled();
    expect((await db.execute(sql`SELECT * FROM mutations`)).rowCount).toBe(0);
    fixture.sync.mockResolvedValue(result);
    expect((await startT631Run(true, "actor", true)).run.status).toBe("success");
  });

  it.each(["idle", "terminated"])("releases fences after a %s connection and rejects late worker writes", async mode => {
    const resume = deferred();
    const entered = deferred();
    const finished = deferred();
    const committed = vi.fn();
    let pid = 0;
    let lateError: unknown;
    fixture.sync.mockImplementation(async (_data, _dry, unit) => {
      await unit(async () => {
        try {
          onAfterCommit(committed);
          await getClient().execute(sql`INSERT INTO mutations VALUES ('rolled back')`);
          pid = Number((await getClient().execute(sql`SELECT pg_backend_pid() AS pid`)).rows[0].pid);
          if (mode === "idle") await getClient().execute(sql`SET LOCAL idle_in_transaction_session_timeout = '150ms'`);
          entered.resolve();
          await resume.promise;
          await getClient().execute(sql`INSERT INTO mutations VALUES ('late')`);
        } catch (error) { lateError = error; throw error; }
        finally { finished.resolve(); }
      });
      return result;
    });
    const accepted = await startT631Run(false, "actor");
    await entered.promise;
    if (mode === "terminated") await db.execute(sql`SELECT pg_terminate_backend(${pid})`);
    expect((await terminal(accepted.run.id)).status).toBe("interrupted");
    expect((await db.execute(sql`SELECT * FROM mutations`)).rowCount).toBe(0);
    fixture.sync.mockResolvedValue(result);
    expect((await startT631Run(true, "actor", true)).run.status).toBe("success");
    resume.resolve();
    await finished.promise;
    expect(lateError).toBeDefined();
    expect(committed).not.toHaveBeenCalled();
    expect((await db.execute(sql`SELECT * FROM mutations`)).rowCount).toBe(0);
  });

  it("allows business SQL beyond five seconds and restores settings on pool reuse", async () => {
    const settingsQuery = `SELECT current_setting('statement_timeout') AS statement,
      current_setting('idle_in_transaction_session_timeout') AS idle,
      current_setting('application_name') AS name`;
    const baseline = (await pool.query(settingsQuery)).rows[0];
    const committed = vi.fn();
    await runInTransaction(async () => {
      onAfterCommit(committed);
      await getClient().execute(sql`SELECT pg_sleep(5.1)`);
    }, { statementMs: 60_000, idleMs: 15_000, applicationName: "t631:test-unit" });
    expect(committed).toHaveBeenCalledOnce();
    const clients = await Promise.all(Array.from({ length: pool.totalCount }, () => pool.connect()));
    try {
      for (const client of clients) {
        const { rows } = await client.query(settingsQuery);
        expect(rows[0]).toEqual(baseline);
      }
    } finally { clients.forEach(client => client.release()); }
    await expect(runInTransaction(() => runInTransaction(async () => {},
      { statementMs: 1, idleMs: 1, applicationName: "nested" }))).rejects.toThrow("outer transaction");
  });

  it("accepts before a slow fetch, survives request scope, and retains full exact-run results", async () => {
    const slow = deferred();
    fixture.fetch.mockImplementation(async () => { await slow.promise; return { success: true, data: { success: true, data: { workers: [] } } }; });
    const start = Date.now();
    const accepted = await runInTransaction(() => startT631Run(true, "actor"));
    expect(Date.now() - start).toBeLessThan(1000);
    expect(accepted.run.status).toBe("running");
    expect((await readT631Run())?.id).toBe(accepted.run.id);
    const duplicate = await startT631Run(false, "scheduler", true);
    expect(duplicate).toMatchObject({ duplicate: true, run: { id: accepted.run.id } });
    expect(pool.idleCount).toBe(pool.totalCount);
    slow.resolve();
    const finished = await terminal(accepted.run.id);
    expect(publicT631Run(finished)).toMatchObject({ dryRun: true, result });
    expect(fixture.fetch).toHaveBeenCalledTimes(1);
  });

  it("shares exclusion across simultaneous manual and scheduled starts", async () => {
    const slow = deferred();
    fixture.sync.mockImplementation(async () => { await slow.promise; return result; });
    const manual = await startT631Run(false, "actor");
    const other = await Promise.all(Array.from({ length: 5 }, () => startT631Run(true, "scheduler", true)));
    expect(other.every(r => r.duplicate && r.run.id === manual.run.id)).toBe(true);
    slow.resolve();
    await terminal(manual.run.id);
  });

  it("does not interrupt a live owner just because its heartbeat expired", async () => {
    const slow = deferred();
    fixture.sync.mockImplementation(async () => { await slow.promise; return result; });
    const { run } = await startT631Run(false, "actor");
    await db.update(jobRuns).set({ heartbeatAt: new Date(0) });
    expect((await readT631Run(run.id))?.status).toBe("running");
    slow.resolve();
    await terminal(run.id);
  });

  it("rolls back an expired in-flight unit before takeover admission and rejects late completion", async () => {
    const inUnit = deferred(), finishUnit = deferred(), oldFinished = deferred();
    let secondMutation = false;
    let committed = false;
    fixture.sync.mockImplementation(async (_payload, _dry, unit) => {
      // Shorten this fixture's lease before acquiring its transaction row lock.
      await db.execute(sql`UPDATE semaphores SET expires_at = clock_timestamp() + interval '150 milliseconds'`);
      try {
        await unit(async () => {
          await getClient().execute(sql`INSERT INTO mutations VALUES ('old')`);
          onAfterCommit(() => { committed = true; });
          inUnit.resolve();
          await finishUnit.promise;
        });
        await unit(async () => { secondMutation = true; });
        return result;
      } catch (error) {
        expect(error).toBeInstanceOf(SyncInterrupted);
        throw error;
      } finally { oldFinished.resolve(); }
    });
    const { run } = await startT631Run(false, "actor");
    await inUnit.promise;
    await new Promise(r => setTimeout(r, 180));
    fixture.sync.mockResolvedValue(result);
    let admitted = false;
    const replacement = startT631Run(true, "scheduler", true).then(value => { admitted = true; return value; });
    await new Promise(r => setTimeout(r, 40));
    expect(admitted).toBe(false);
    expect((await db.execute(sql`SELECT * FROM mutations`)).rowCount).toBe(0);
    finishUnit.resolve();
    await oldFinished.promise;
    expect((await replacement).run.status).toBe("success");
    expect(committed).toBe(false);
    expect(secondMutation).toBe(false);
    expect((await db.execute(sql`SELECT * FROM mutations`)).rowCount).toBe(0);
    expect((await readT631Run(run.id))?.status).toBe("interrupted");
    expect(fixture.sync).toHaveBeenCalledTimes(2);
  });

  it("keeps polling and duplicate starts safe while a unit exceeds bounded row-lock waits", async () => {
    const entered = deferred(), finish = deferred();
    fixture.sync.mockImplementation(async (_payload, _dry, unit) => {
      await unit(async () => { entered.resolve(); await finish.promise; });
      return result;
    });
    const { run } = await startT631Run(false, "actor");
    await entered.promise;
    try {
      expect((await readT631Run(run.id))?.status).toBe("running");
      expect(await startT631Run(true, "scheduler", true)).toMatchObject({ duplicate: true, run: { id: run.id } });
    } finally { finish.resolve(); }
    expect((await terminal(run.id)).status).toBe("success");
  });

  it("settles a cron waiter on ambiguous renewal without claiming the external fetch was cancelled", async () => {
    const fetching = deferred(), finish = deferred();
    fixture.fetch.mockImplementation(async () => {
      fetching.resolve(); await finish.promise;
      return { success: true, data: { success: true, data: { workers: [] } } };
    });
    vi.spyOn(semaphoreStorage, "renew").mockRejectedValue(new Error("uncertain renewal"));
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const waiting = startT631Run(false, "scheduler", true);
    const rejected = expect(waiting).rejects.toThrow("ownership lost");
    await fetching.promise;
    await vi.advanceTimersByTimeAsync(5000);
    await rejected;
    vi.useRealTimers();
    expect(fixture.sync).not.toHaveBeenCalled();
    await db.execute(sql`UPDATE semaphores SET expires_at = clock_timestamp() - interval '1 second'
      WHERE key = ${T631_RESOURCE}`);
    const recovered = await readT631Run();
    expect(recovered?.status).toBe("interrupted");
    finish.resolve();
    await new Promise(r => setTimeout(r, 30));
    expect((await readT631Run(recovered!.id))?.status).toBe("interrupted");
    expect(fixture.sync).not.toHaveBeenCalled();
  });

  it("rejects a superseded token's late success without overwriting recovered history", async () => {
    const reconciling = deferred(), finish = deferred(), oldFinished = deferred();
    fixture.sync.mockImplementationOnce(async () => {
      reconciling.resolve(); await finish.promise; oldFinished.resolve();
      return result;
    });
    const { run } = await startT631Run(false, "actor");
    await reconciling.promise;
    await db.execute(sql`UPDATE semaphores SET expires_at = clock_timestamp() - interval '1 second'`);
    const replacement = await startT631Run(true, "scheduler", true);
    expect(replacement.run.status).toBe("success");
    finish.resolve();
    await oldFinished.promise;
    await new Promise(r => setTimeout(r, 30));
    expect((await readT631Run(run.id))?.status).toBe("interrupted");
    expect((await readT631Run(replacement.run.id))?.status).toBe("success");
  });

  it.each([
    ["remote", { success: false, error: "sensitive remote content" }, undefined, "Remote failure"],
    ["invalid payload", { success: true, data: { success: true, data: {} } }, undefined, "Remote failure"],
    ["configuration", undefined, Object.assign(new Error("sensitive config content"), { name: "ConfigError" }), "Configuration refusal"],
  ])("records sanitized %s failures before reconciliation", async (_label, value, error, message) => {
    if (error) fixture.fetch.mockRejectedValue(error);
    else fixture.fetch.mockResolvedValue(value);
    const { run } = await startT631Run(false, "actor", true);
    expect(run.status).toBe("error");
    expect(run.error).toContain(message);
    expect(run.error).not.toContain("sensitive");
    expect(fixture.sync).not.toHaveBeenCalled();
  });

  it("refuses maintenance/component-off starts and records maintenance during execution", async () => {
    setMaintenanceActive(true);
    await expect(startT631Run(false, "actor")).rejects.toThrow("maintenance");
    setMaintenanceActive(false);
    fixture.enabled = false;
    await expect(startT631Run(false, "actor")).rejects.toThrow("both EDLS");
    fixture.enabled = true;
    fixture.sync.mockImplementation(async (_payload, _dry, unit) => {
      setMaintenanceActive(true);
      await unit(async () => {});
      return result;
    });
    const { run } = await startT631Run(false, "actor", true);
    expect(run.error).toContain("Maintenance refusal");
  });

  it("preserves effective actor in detached worker units", async () => {
    let afterCommit = false;
    fixture.sync.mockImplementation(async (_payload, _dry, unit) => {
      await unit(async () => {
        expect(requestContext.getStore()?.userId).toBe("effective");
        await getClient().execute(sql`SELECT 1`);
        onAfterCommit(() => { afterCommit = true; });
      });
      return result;
    });
    const { run } = await runInTransaction(async () => {
      await getClient().execute(sql`SET LOCAL transaction_read_only = on`);
      return startT631Run(false, "effective", true);
    });
    expect(run.triggeredBy).toBe("effective");
    expect(run.status).toBe("success");
    expect(afterCommit).toBe(true);
  });

  it("does not expose a run from another job kind", async () => {
    const [foreign] = await db.insert(jobRuns).values({
      pluginKind: "oneoff", pluginId: "sitespecific-t631-worker-fetch", status: "success",
    }).returning();
    expect(await readT631Run(foreign.id)).toBeUndefined();
  });
});
