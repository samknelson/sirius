import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";

// Real Postgres exclusion/transaction tests, isolated from application run rows
// and workers. No vendor request or reconciliation touches real worker data.
const fixture = vi.hoisted(() => ({
  table: `test_t631_runs_${process.pid}`,
  fetch: vi.fn(), sync: vi.fn(), enabled: true,
}));
vi.mock("../../server/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
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
import { getClient, runInTransaction } from "../../server/storage/transaction-context";
import { requestContext } from "../../server/middleware/request-context";
import { setMaintenanceActive } from "../../server/services/maintenance-flag";
import { startT631Run, readT631Run, publicT631Run } from "../../server/services/t631-sync-runs";
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
});
beforeEach(async () => {
  setMaintenanceActive(false);
  fixture.enabled = true;
  fixture.fetch.mockReset().mockResolvedValue({ success: true, data: { success: true, data: { workers: [] } } });
  fixture.sync.mockReset().mockResolvedValue(result);
  await db.delete(jobRuns);
});
afterAll(async () => {
  setMaintenanceActive(false);
  vi.restoreAllMocks();
  await db.execute(sql.raw(`DROP SCHEMA IF EXISTS "${fixture.table}" CASCADE`));
  await pool.end();
});

describe("durable T631 execution", () => {
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

  it("fences a lost owner after its in-flight worker and never replays or overwrites terminal status", async () => {
    const inUnit = deferred(), finishUnit = deferred(), nextUnit = deferred();
    let secondMutation = false;
    fixture.sync.mockImplementation(async (_payload, _dry, unit) => {
      await unit(async () => { inUnit.resolve(); await finishUnit.promise; });
      await nextUnit.promise;
      await unit(async () => { secondMutation = true; });
      return result;
    });
    const { run } = await startT631Run(false, "actor");
    await inUnit.promise;
    const pid = (await db.execute(sql`SELECT pid FROM pg_locks WHERE locktype = 'advisory'
      AND classid = 0 AND objid = 2032001 AND granted`)).rows[0].pid;
    await db.execute(sql`SELECT pg_terminate_backend(${pid})`);
    await new Promise(r => setTimeout(r, 30));
    // Recovery cannot infer that the unit stopped simply because OWNER vanished.
    expect((await readT631Run(run.id))?.status).toBe("running");
    await expect(startT631Run(false, "other")).rejects.toThrow("finishing its current worker");
    finishUnit.resolve();
    await new Promise(r => setTimeout(r, 30));
    expect((await readT631Run(run.id))?.status).toBe("interrupted");
    nextUnit.resolve();
    await new Promise(r => setTimeout(r, 50));
    expect(secondMutation).toBe(false);
    expect((await readT631Run(run.id))?.status).toBe("interrupted");
    expect(fixture.sync).toHaveBeenCalledTimes(1);
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
    fixture.sync.mockImplementation(async (_payload, _dry, unit) => {
      await unit(async () => {
        expect(requestContext.getStore()?.userId).toBe("effective");
        await getClient().execute(sql`SELECT 1`);
      });
      return result;
    });
    const { run } = await startT631Run(false, "effective", true);
    expect(run.triggeredBy).toBe("effective");
    expect(run.status).toBe("success");
  });

  it("does not expose a run from another job kind", async () => {
    const [foreign] = await db.insert(jobRuns).values({
      pluginKind: "oneoff", pluginId: "sitespecific-t631-worker-fetch", status: "success",
    }).returning();
    expect(await readT631Run(foreign.id)).toBeUndefined();
  });
});
