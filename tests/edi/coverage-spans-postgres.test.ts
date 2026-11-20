import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { AsyncLocalStorage } from "node:async_hooks";
import type { DenormPlugin } from "../../server/plugins/system/denorm/types";

const state = vi.hoisted(() => ({ db: undefined as any, context: undefined as any }));
vi.mock("../../server/services/component-cache", () => ({ isComponentEnabledSync: () => true }));
vi.mock("../../server/db", () => ({ db: new Proxy({}, {
  get: (_target, key) => {
    const value = state.db[key];
    return typeof value === "function" ? value.bind(state.db) : value;
  },
}) }));
vi.mock("../../server/services/migration-runner", () => ({ registerMigration: () => {} }));
vi.mock("../../server/storage/transaction-context", () => ({
  getClient: () => state.context.getStore() ?? state.db,
  runWithTransaction: (tx: unknown, fn: () => Promise<unknown>) => state.context.run(tx, fn),
  runInTransaction: (fn: () => Promise<unknown>) => state.context.getStore()
    ? fn() : state.db.transaction((tx: unknown) => state.context.run(tx, fn)),
}));
vi.mock("../../server/storage", async () => {
  const { createDenormStorage } = await import("../../server/storage/system/denorm");
  return { storage: { denorm: createDenormStorage() } };
});
import { createDenormStorage } from "../../server/storage/system/denorm";
import { createDenormSpansStorage } from "../../server/storage/system/denorm-spans";
import { applyComputed } from "../../server/plugins/system/denorm/apply";
import { maintainedStarts } from "../../server/plugins/trust/provider-edi/maintained-coverage";
import { assertCoverageEventsReady } from "../../server/plugins/trust/provider-edi/coverage-readiness";
import { deriveCoverageSpans } from "../../server/services/coverage-spans/derive";
import { COVERAGE_SPAN_PLUGIN, type CoverageSpanPayload } from "@shared/coverage-span";
import migration from "../../scripts/migrate/core/1226_reconcile_denorm_spans";
import { createCoverageSpanSourceStorage } from "../../server/storage/trust/coverage-span-source";
import { enqueueCoverageSpanInvalidations } from "../../server/storage/trust/coverage-span-invalidation";
import { compareCoverageSpanEvidence } from "../../server/services/coverage-spans/compare";
import { createWorkerStorage } from "../../server/storage/workers";
import { createWmbScanQueueStorage } from "../../server/storage/wmb-scan-queue";
import { maintainedTerminations } from "../../server/plugins/trust/provider-edi/maintained-coverage";
import { createTrustWmbEventsStorage } from "../../server/storage/trust/wmb-events";

// Always isolated: no application URL, credentials or production records.
describe("maintained coverage on isolated PostgreSQL", () => {
  let root: string, pool: pg.Pool;
  const status = createDenormStorage(), payload = createDenormSpansStorage();
  const plugin: DenormPlugin<CoverageSpanPayload> = {
    metadata: { id: COVERAGE_SPAN_PLUGIN, name: "Fixture", description: "Isolated coverage fixture" }, entityType: "worker",
    reads: [], writes: [],
    compute: async () => ({ spans: [], issues: [] }),
    write: async (_id, data, denormId) => payload.replace(denormId,
      data.spans.map(s => ({ subjectId: s.benefitId, startMonth: s.startMonth, lastMonth: s.lastCoveredMonth,
        terminationMonth: s.ending?.month ?? null, data: s })),
      data.issues.map(i => ({ subjectId: i.benefitId, month: i.month, reason: i.reason, data: i }))),
  };
  const seed = { entityId: "worker", entityType: "worker", configId: "config" };
  const facts = deriveCoverageSpans("worker", [1, 2, 3].map(month => ({
    id: `w-${month}`, workerId: "worker", benefitId: "benefit", year: 2026, month,
    employerId: "employer", employerSiriusId: "ordinary", sourceRelationId: null,
  })), [], []);
  const ctx = () => ({
    storage: {
      pluginConfigs: { getByKindAndPlugin: async (_kind: string, pluginId: string) =>
        (await pool.query("SELECT id,enabled FROM plugin_configs WHERE plugin_kind='denorm' AND plugin_id=$1", [pluginId])).rows },
      readOnly: { query: (fn: (db: any) => unknown) => fn(state.db) },
    },
  } as any);
  beforeAll(async () => {
    root = mkdtempSync(path.join(tmpdir(), "coverage-spans-"));
    execFileSync("initdb", ["-D", `${root}/data`, "-A", "trust", "-U", "postgres"], { stdio: "ignore" });
    execFileSync("pg_ctl", ["-D", `${root}/data`, "-l", `${root}/postgres.log`,
      "-o", `-k ${root} -h ''`, "-w", "start"], { stdio: "ignore" });
    pool = new pg.Pool({ host: root, user: "postgres", database: "postgres", max: 4 });
    state.db = drizzle(pool);
    state.context = new AsyncLocalStorage();
    await pool.query(`
      CREATE TABLE plugin_configs (id varchar PRIMARY KEY, plugin_kind varchar, plugin_id varchar, enabled boolean);
      INSERT INTO plugin_configs VALUES ('config', 'denorm', '${COVERAGE_SPAN_PLUGIN}', true);
      INSERT INTO plugin_configs VALUES ('terminate-config', 'denorm', 'trust-wmb-terminate', true);
      CREATE TABLE workers (id varchar PRIMARY KEY);
      INSERT INTO workers VALUES ('worker');
      CREATE TABLE denorm (id varchar PRIMARY KEY DEFAULT gen_random_uuid(), entity_id varchar NOT NULL,
        entity_type varchar NOT NULL, config_id varchar REFERENCES plugin_configs(id) ON DELETE CASCADE,
        status varchar NOT NULL, computed_at timestamp, stale_at timestamp, message varchar,
        generation integer NOT NULL DEFAULT 1, claim_token varchar, claim_at timestamp,
        UNIQUE(entity_id, config_id));
      CREATE TABLE trust_wmb(id varchar PRIMARY KEY, worker_id varchar, benefit_id varchar,
        year int, month int, source_relation_id varchar);
      INSERT INTO trust_wmb VALUES ('w-3','worker','benefit',2026,3,NULL);
    `);
    await migration.up();
    await migration.up(); // Idempotent upgrade; no optional benefit tables needed.
  }, 30_000);
  afterAll(async () => {
    await pool?.end();
    if (root) {
      execFileSync("pg_ctl", ["-D", `${root}/data`, "-m", "immediate", "-w", "stop"], { stdio: "ignore" });
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("distinguishes initial, stale, failed, ready and computed-empty populations", async () => {
    await expect(assertCoverageEventsReady(ctx(), [], 0, 0, false)).rejects.toThrow("1 awaiting initial backfill");
    await status.insertStaleBatch([seed]);
    await expect(assertCoverageEventsReady(ctx(), [], 0, 0, false)).rejects.toThrow("1 stale");
    const claim = (await status.claimStaleForEntity(seed, "failure"))!;
    await status.markErrorIfGeneration(seed, claim.generation, claim.claimToken, "fixture failure");
    await expect(assertCoverageEventsReady(ctx(), [], 0, 0, false)).rejects.toThrow("1 failed");
    await status.insertStaleBatch([seed]);
    const ready = (await status.claimStaleForEntity(seed, "ready"))!;
    expect(await applyComputed(plugin, "config", "worker", facts, ready.generation, ready.claimToken)).toBe(true);
    expect(await assertCoverageEventsReady(ctx(), [], 0, 0, false)).toMatchObject({ population: 1 });
    expect(await maintainedStarts(state.db, ["w-3"])).toMatchObject([{ coverageStartYmd: "2026-01-01" }]);
  });
  it("rejects an intervening invalidation and competing claims without erasing fresh work", async () => {
    await status.insertStaleBatch([seed]);
    const claim = (await status.claimStaleForEntity(seed, "old"))!;
    expect(await status.claimStaleForEntity(seed, "competitor")).toBeUndefined();
    await status.insertStaleBatch([seed]);
    expect(await applyComputed(plugin, "config", "worker", { spans: [], issues: [] },
      claim.generation, claim.claimToken)).toBe(false);
    expect((await status.get("worker", "config"))?.status).toBe("stale");
    expect(await maintainedStarts(state.db, ["w-3"])).toEqual([]);
    expect((await pool.query("SELECT count(*) FROM denorm_span")).rows[0].count).toBe("1");
  });
  it("rolls back failed replacement and publishes spans and issues together", async () => {
    await pool.query(`INSERT INTO denorm_issue(denorm_id,subject_id,month,reason,data)
      SELECT id,'benefit','2026-02-01','fixture-issue','{}' FROM denorm WHERE entity_id='worker'`);
    const claim = (await status.claimStaleForEntity(seed, "replace"))!;
    const failing = { ...plugin, write: async (...args: Parameters<typeof plugin.write>) => {
      await plugin.write(...args);
      throw new Error("forced failure after writes");
    } };
    await expect(applyComputed(failing, "config", "worker", { spans: [], issues: [] },
      claim.generation, claim.claimToken)).rejects.toThrow("forced failure");
    expect((await status.get("worker", "config"))?.status).toBe("stale");
    expect((await pool.query("SELECT count(*) FROM denorm_span")).rows[0].count).toBe("1");
    expect((await pool.query("SELECT count(*) FROM denorm_issue")).rows[0].count).toBe("1");
    expect(await applyComputed(plugin, "config", "worker", { spans: [], issues: [] },
      claim.generation, claim.claimToken)).toBe(true);
    expect(await assertCoverageEventsReady(ctx(), [], 0, 0, false)).toMatchObject({ population: 1 });
    expect((await pool.query("SELECT count(*) FROM denorm_span")).rows[0].count).toBe("0");
    expect((await pool.query("SELECT count(*) FROM denorm_issue")).rows[0].count).toBe("0");
  });
  it("refuses disabled or ambiguous producer configurations and invalid month boundaries", async () => {
    for (const configs of [[], [{ id: "config", enabled: false }],
      [{ id: "config", enabled: true }, { id: "other", enabled: true }]]) {
      const context = ctx();
      context.storage.pluginConfigs.getByKindAndPlugin = async () => configs;
      await expect(assertCoverageEventsReady(context, [], 0, 0, false)).rejects.toThrow("exactly one enabled");
    }
    await expect(pool.query(`INSERT INTO denorm_span(denorm_id,subject_id,start_month,last_month,data)
      SELECT id,'benefit','2026-02-02','2026-03-01','{}' FROM denorm`)).rejects.toThrow("denorm_span_months_check");
    await expect(pool.query(`INSERT INTO denorm_issue(denorm_id,subject_id,month,reason,data)
      SELECT id,'benefit','2026-02-02','invalid','{}' FROM denorm`)).rejects.toThrow("denorm_issue_month_check");
  });
  it("cascades both stores and uses the ending index on a representative local population", async () => {
    await pool.query(`INSERT INTO denorm_span(denorm_id,subject_id,start_month,last_month,termination_month,data)
      SELECT d.id,'benefit-' || (n % 100), date '2025-01-01', date '2025-12-01',
        date '2026-01-01' + make_interval(months => (n / 100) % 12),'{}'
      FROM denorm d CROSS JOIN generate_series(1,100000) n;
      ANALYZE denorm_span`);
    const plan = await pool.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
      SELECT data FROM denorm_span WHERE subject_id='benefit-12' AND termination_month=date '2026-01-01'`);
    const text = JSON.stringify(plan.rows);
    expect(text).toContain("denorm_span_subject_termination_idx");
    process.stdout.write(`LOCAL SYNTHETIC ending lookup ${JSON.stringify(plan.rows[0]["QUERY PLAN"][0])}\n`);
    await status.clearForConfig("config");
    expect((await pool.query("SELECT count(*) FROM denorm_span")).rows[0].count).toBe("0");
    expect((await pool.query("SELECT count(*) FROM denorm_issue")).rows[0].count).toBe("0");
  });
  it("reads bounded source facts and transactionally invalidates receiving families", async () => {
    await pool.query(`
      ALTER TABLE trust_wmb ADD COLUMN employer_id varchar DEFAULT 'employer';
      CREATE TABLE employers(id varchar PRIMARY KEY, sirius_id varchar);
      INSERT INTO employers VALUES ('employer','ordinary');
      CREATE TABLE worker_relations(id varchar PRIMARY KEY, worker_1 varchar, worker_2 varchar);
      INSERT INTO worker_relations VALUES ('family','worker','dependent');
      CREATE TABLE trust_wmb_events(id varchar PRIMARY KEY,worker_id varchar,benefit_id varchar,
        year int, month int,event_type varchar,data jsonb);
      INSERT INTO trust_wmb_events VALUES ('event','worker','benefit',2026,4,'terminate','{}');
      INSERT INTO trust_wmb_events VALUES ('restart','worker','benefit',2026,3,'restart','{}');
      CREATE TABLE trust_wmb_scan_queue(id varchar PRIMARY KEY,worker_id varchar,year int,month int,
        status varchar,completed_at timestamp,result_summary jsonb);
      INSERT INTO trust_wmb_scan_queue VALUES ('scan','worker',2026,4,'success',now(),
        '{"actions":[{"benefitId":"benefit","scanType":"continue","eligible":false}]}');
    `);
    const source = await createCoverageSpanSourceStorage().read("worker");
    expect(source.events).toMatchObject([{ decision: "confirmed", scanId: "scan" }]);
    expect(deriveCoverageSpans("worker", source.coverage, source.families, source.events).spans[0].ending)
      .toMatchObject({ reason: "confirmed-continuation-failure", scanId: "scan" });
    await enqueueCoverageSpanInvalidations(["worker"]);
    expect((await status.get("dependent", "config"))?.status).toBe("stale");
    const initial = (await status.claimStaleForEntity(seed, "comparison"))!;
    await applyComputed(plugin, "config", "worker",
      deriveCoverageSpans("worker", source.coverage, source.families, source.events),
      initial.generation, initial.claimToken);
    const comparisonContext = ctx();
    await status.upsertStatus({ entityId: "worker", entityType: "worker", configId: "terminate-config", status: "ok" });
    comparisonContext.input = { asOfDate: "2026-04-01" };
    comparisonContext.configData = {};
    comparisonContext.terminationPolicy = { subscribers: true, dependents: true, months: 1 };
    let transactions = 0;
    comparisonContext.storage.readOnly.query = (fn: (db: any) => unknown) => { transactions++; return fn(state.db); };
    const comparison = await compareCoverageSpanEvidence(comparisonContext, ["w-3"], ["benefit"]);
    expect(comparison.startDifferences).toEqual([]);
    expect(comparison.endingDifference).toBeNull();
    process.stdout.write(`LOCAL SYNTHETIC source comparison ${JSON.stringify({ ...comparison, transactions })}\n`);
    await enqueueCoverageSpanInvalidations(["worker"]);
    const claim = (await status.claimStaleForEntity(seed, "source-edit"))!;
    await state.db.transaction((tx: any) => state.context.run(tx, async () => {
      await tx.execute((await import("drizzle-orm")).sql`UPDATE trust_wmb SET month = 4 WHERE id = 'w-3'`);
      await enqueueCoverageSpanInvalidations(["worker"]);
    }));
    expect(await applyComputed(plugin, "config", "worker", facts, claim.generation, claim.claimToken)).toBe(false);
    const corrected = await createCoverageSpanSourceStorage().read("worker");
    expect(deriveCoverageSpans("worker", corrected.coverage, corrected.families, corrected.events).spans[0].ending).toBeNull();
  });
  it("refuses apparently ready empty spans until upstream endings are complete and enabled", async () => {
    await status.insertStaleBatch([seed]);
    const claim = (await status.claimStaleForEntity(seed, "ahead-of-upstream"))!;
    await applyComputed(plugin, "config", "worker", { spans: [], issues: [] }, claim.generation, claim.claimToken);
    await status.clearForConfig("terminate-config");
    await expect(assertCoverageEventsReady(ctx(), [], 0, 0, true)).rejects.toThrow("trust-wmb-terminate");
    for (const upstream of ["stale", "error"] as const) {
      await status.upsertStatus({ entityId: "worker", entityType: "worker", configId: "terminate-config", status: upstream });
      await expect(assertCoverageEventsReady(ctx(), [], 0, 0, true)).rejects.toThrow("trust-wmb-terminate");
    }
    await status.upsertStatus({ entityId: "worker", entityType: "worker", configId: "terminate-config", status: "ok" });
    await pool.query("UPDATE plugin_configs SET enabled=false WHERE id='terminate-config'");
    await expect(assertCoverageEventsReady(ctx(), [], 0, 0, true)).rejects.toThrow("exactly one enabled");
    await pool.query("UPDATE plugin_configs SET enabled=true WHERE id='terminate-config'");
    await expect(assertCoverageEventsReady(ctx(), [], 0, 0, true)).resolves.toMatchObject({ population: 1 });
    await pool.query(`ALTER TABLE trust_wmb_events ALTER COLUMN id SET DEFAULT gen_random_uuid();
      CREATE UNIQUE INDEX fixture_event_key ON trust_wmb_events(worker_id,year,month,benefit_id,event_type)`);
    await createTrustWmbEventsStorage().replaceForWorkerAndType("worker", "terminate", [
      { benefitId: "benefit", year: 2026, month: 5, data: { failedPlugins: [] } },
    ]);
    // Completion of upstream maintenance invalidates an already-ready empty
    // downstream answer in the SAME transaction as the newly retained event.
    await expect(assertCoverageEventsReady(ctx(), [], 0, 0, true)).rejects.toThrow("worker-benefit-coverage-spans");
  });
  it("scopes unsupported ending issues to enabled roles and refuses unknown roles", async () => {
    const context = ctx();
    context.input = { asOfDate: "2026-04-01" };
    context.configData = {};
    const d = (await status.get("worker", "config"))!;
    for (const sourceRelationId of [null, "family"]) for (const reason of ["unsupported-termination", "contradicted-inference"]) {
      const issue = { workerId: "worker", benefitId: "benefit", month: "2026-04-01",
        reason, eventId: "event", relatedRecords: [],
        records: [{ sourceRelationId }] };
      await payload.replace(d.id, [], [{ subjectId: "benefit", month: issue.month, reason: issue.reason, data: issue }]);
      context.terminationPolicy = { subscribers: sourceRelationId !== null, dependents: sourceRelationId === null, months: 1 };
      await expect(maintainedTerminations(context, ["benefit"])).resolves.toMatchObject({ selected: [] });
      context.terminationPolicy = { subscribers: sourceRelationId === null, dependents: sourceRelationId !== null, months: 1 };
      await expect(maintainedTerminations(context, ["benefit"])).rejects.toThrow(reason);
    }
    await payload.replace(d.id, [], [{ subjectId: "benefit", month: "2026-04-01",
      reason: "termination-coverage-missing", data: { records: [], workerId: "worker" } }]);
    await expect(maintainedTerminations(context, ["benefit"])).rejects.toThrow("needs correction");
    await payload.replace(d.id, [], []);
  });
  it("requeueing a completed worker scan invalidates current and retained family receivers atomically", async () => {
    await pool.query(`
      CREATE TABLE trust_wmb_scan_status(id varchar PRIMARY KEY,month int,year int,
        scope_type varchar,scope_employer_id varchar,status varchar,total_queued int,
        processed_success int,processed_failed int,benefits_started int,benefits_continued int,
        benefits_terminated int,queued_at timestamp,started_at timestamp,completed_at timestamp,last_error text);
      INSERT INTO trust_wmb_scan_status(id,month,year,scope_type,status,queued_at)
        VALUES('run',4,2026,'all','completed',now());
      ALTER TABLE trust_wmb_scan_queue ADD COLUMN status_id varchar DEFAULT 'run',
        ADD COLUMN trigger_source varchar, ADD COLUMN scheduled_for timestamp,
        ADD COLUMN picked_at timestamp, ADD COLUMN attempts int, ADD COLUMN last_error text;
      UPDATE trust_wmb_scan_queue SET status='success',
        result_summary=result_summary || '{"people":[{"workerId":"old-dependent"}]}'::jsonb;
    `);
    for (const entityId of ["worker", "dependent", "old-dependent"])
      await status.upsertStatus({ ...seed, entityId, status: "ok" });
    const before = (await status.get("worker", "config"))!.generation;
    expect((await createWmbScanQueueStorage().enqueueWorker("worker", 4, 2026, "manual")).status).toBe("pending");
    for (const entityId of ["worker", "dependent", "old-dependent"])
      expect((await status.get(entityId, "config"))?.status).toBe("stale");
    expect((await status.get("worker", "config"))!.generation).toBeGreaterThan(before);
    await expect(assertCoverageEventsReady(ctx(), [], 0, 0, true)).rejects.toThrow("stale");
    expect((await createCoverageSpanSourceStorage().read("worker")).events[0].decision).toBe("unsupported");
  });
  it.each(["month", "single-invalidation", "bulk-invalidation"] as const)(
    "%s preserves former people/actions recipients before removing scan evidence", async mode => {
      await pool.query(`INSERT INTO workers VALUES ('old-dependent'),('action-dependent') ON CONFLICT DO NOTHING`);
      const now = new Date(), month = now.getMonth() + 1, year = now.getFullYear();
      await pool.query(`UPDATE trust_wmb_scan_status SET month=$1,year=$2,status='completed' WHERE id='run';
      `, [month, year]);
      await pool.query(`UPDATE trust_wmb_scan_queue SET month=$1,year=$2,status='success',
        result_summary='{"people":[{"workerId":"old-dependent"}],"actions":[{"workerId":"action-dependent","benefitId":"benefit","scanType":"continue","eligible":false}]}'::jsonb`,
      [month, year]);
      for (const entityId of ["worker", "old-dependent", "action-dependent"]) {
        const d = await status.upsertStatus({ ...seed, entityId, status: "ok" });
        await payload.replace(d.id, facts.spans.map(s => ({
          subjectId: s.benefitId, startMonth: s.startMonth, lastMonth: s.lastCoveredMonth,
          terminationMonth: "2026-04-01", data: { ...s, workerId: entityId,
            ending: { month: "2026-04-01", reason: "confirmed-continuation-failure", eventId: `ending-${entityId}` } },
        })), []);
      }
      const queue = createWmbScanQueueStorage();
      if (mode === "month") {
        // Only population discovery is stubbed. Reset, snapshot locks,
        // invalidation and payload/readiness queries use real PostgreSQL.
        vi.spyOn(queue, "getSubscriberIdsForMonth").mockResolvedValue(["worker"]);
        await queue.enqueueMonth(month, year);
      } else if (mode === "single-invalidation") await queue.invalidateWorkerScans("worker");
      else await queue.invalidateWorkerScansBulk(["worker"]);
      expect((await pool.query("SELECT result_summary FROM trust_wmb_scan_queue")).rows[0].result_summary).toBeNull();
      for (const entityId of ["worker", "old-dependent", "action-dependent"])
        expect((await status.get(entityId, "config"))?.status).toBe("stale");
      const owner = (await status.claimStaleForEntity(seed, `reset-${mode}`))!;
      await applyComputed(plugin, "config", "worker", { spans: [], issues: [] }, owner.generation, owner.claimToken);
      // Recomputing just the queue owner cannot make the former recipient's
      // obsolete ending acceptable. Both live recipients remain in the barrier.
      await expect(assertCoverageEventsReady(ctx(), [], 0, 0, false)).rejects.toThrow("2 stale");
    });
  it("resumes bounded backfill and drains representative synthetic worker spans", async () => {
    await pool.query(`INSERT INTO workers SELECT 'population-' || n FROM generate_series(1,1000) n`);
    const workers = createWorkerStorage({} as never);
    const started = performance.now(), before = process.memoryUsage();
    let enqueued = 0, batches = 0, applied = 0;
    for (;;) {
      const ids = await workers.findIdsMissingDenorm("config", 200);
      if (!ids.length) break;
      expect(ids.length).toBeLessThanOrEqual(200);
      enqueued += await status.insertStaleBatch(ids.map(entityId => ({ ...seed, entityId })));
      batches++;
      // A repeated source enumeration must advance, not requeue old work.
    }
    expect(enqueued).toBe(1000);
    expect(batches).toBe(5);
    for (;;) {
      const claims = await status.claimStaleBatchForConfig("config", 200, `batch-${applied}`);
      if (!claims.length) break;
      for (const claim of claims) {
        const coverage = Array.from({ length: 24 }, (_, i) => ({
          id: `${claim.entityId}-${i}`, workerId: claim.entityId, benefitId: "benefit",
          year: 2025 + Math.floor(i / 12), month: i % 12 + 1,
          employerId: `ordinary-${i}`, employerSiriusId: "ordinary", sourceRelationId: null,
        }));
        const data = deriveCoverageSpans(claim.entityId, coverage, [], []);
        expect(data.spans).toHaveLength(1);
        if (await applyComputed(plugin, "config", claim.entityId, data, claim.generation, claim.claimToken)) applied++;
      }
    }
    expect(applied).toBeGreaterThanOrEqual(1000);
    const readinessStarted = performance.now();
    expect(await assertCoverageEventsReady(ctx(), [], 0, 0, false)).toMatchObject({ population: 1003 });
    process.stdout.write(`LOCAL SYNTHETIC bounded backfill ${JSON.stringify({
      population: 1000, coverageMonthsPerWorker: 24, enqueued, enqueueBatches: batches, applied,
      elapsedMs: Math.round(performance.now() - started),
      readinessMs: Math.round(performance.now() - readinessStarted),
      before, after: process.memoryUsage(),
    })}\n`);
  }, 60_000);
});
