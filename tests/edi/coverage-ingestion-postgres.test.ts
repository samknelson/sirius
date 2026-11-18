import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import { monitorEventLoopDelay } from "node:perf_hooks";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { discoverCoverage as discoverSource, coverageProjection } from "../../server/plugins/trust/provider-edi/coverage-review";
import { approveConflict, coverageProjectionIndex } from "../../server/plugins/trust/provider-edi/coverage-choices";
import { registeredEdiPlugins } from "./fixtures/harness";
import type { TrustProviderEdiContext } from "../../server/plugins/trust/provider-edi/registry";
import { CoverageBudget, CoverageBudgetError, COVERAGE_LIMITS } from "../../server/plugins/trust/provider-edi/coverage-budget";
import { coverageReader } from "../../server/plugins/trust/provider-edi/coverage-reader";
import { CoverageSpill } from "../../server/plugins/trust/provider-edi/coverage-spill";

describe("coverage resource diagnostics", () => {
  it("isolates staging and cleans only its own evidence on repeated disposal", () => {
    const first = new CoverageSpill(new CoverageBudget());
    const second = new CoverageSpill(new CoverageBudget());
    try {
      const a = first.map<string>(), b = second.map<string>();
      a.set("same", "first"); b.set("same", "second");
      expect(a.get("same")).toBe("first");
      first.dispose(); first.dispose();
      expect(existsSync(first.directory)).toBe(false);
      expect(b.get("same")).toBe("second");
      expect(() => b.set("oversize", "x".repeat(4 * 1024 * 1024))).toThrow(/working-set/);
    } finally { first.dispose(); second.dispose(); }
    expect(existsSync(second.directory)).toBe(false);
  });
  it("reports each exceeded dimension, preserves the meaningful phase and excludes evidence values", () => {
    const check = (trigger: (budget: CoverageBudget) => void, dimension: string) => {
      const budget = new CoverageBudget({ wizardId: "fictional-wizard", runId: "fictional-run" });
      budget.log("phase-start", "Tracing historical families");
      budget.log("database-end", "Coverage page");
      try {
        trigger(budget);
        expect.fail("Expected a whole-run resource refusal");
      } catch (error) {
        expect(error).toBeInstanceOf(CoverageBudgetError);
        const failure = error as CoverageBudgetError;
        expect(failure.diagnostics).toMatchObject({
          wizardId: "fictional-wizard", runId: "fictional-run", phase: "Tracing historical families",
          exceeded: expect.arrayContaining([expect.objectContaining({ dimension })]),
        });
        expect(failure.message).toContain(failure.diagnostics.scanId);
        expect(failure.message).not.toContain("private-fixture-value");
        for (const limit of failure.diagnostics.exceeded) expect(limit.observed).toBeGreaterThan(limit.limit);
      }
    };
    check(budget => budget.check(COVERAGE_LIMITS.keys + 1), "coordinateKeys");
    check(budget => {
      for (let i = 0; i <= COVERAGE_LIMITS.rows; i++) budget.retain({});
    }, "retainedRecords");
    check(budget => {
      const bytes = vi.spyOn(Buffer, "byteLength").mockReturnValue(COVERAGE_LIMITS.bytes + 1);
      try { budget.retain({ value: "private-fixture-value" }); } finally { bytes.mockRestore(); }
    }, "evidenceBytes");
    check(budget => {
      const clock = vi.spyOn(performance, "now").mockReturnValue(performance.now() + COVERAGE_LIMITS.durationMs + 1);
      try { budget.check(); } finally { clock.mockRestore(); }
    }, "elapsedMs");
  });
});

// Opt-in production-shaped ingestion measurement. No app URL, database, member
// record, carrier generation or delivery is touched.
describe.skipIf(process.env.EDI_COVERAGE_PG !== "1").sequential("bounded PostgreSQL coverage ingestion", () => {
  let lastReview: Awaited<ReturnType<typeof discoverSource>> | undefined;
  const discoverCoverage: typeof discoverSource = async (...args) => {
    lastReview?.dispose();
    lastReview = await discoverSource(...args);
    return lastReview;
  };
  let root: string;
  let pool: pg.Pool;
  let ctx: TrustProviderEdiContext;
  let started = false;
  let queries = 0;
  let queryDelayMs = 0;
  const plugin = registeredEdiPlugins().find(p => p.id === "sitespecific-smf-carelon")!;
  beforeAll(async () => {
    root = mkdtempSync(`${tmpdir()}/edi-coverage-pg-`);
    execFileSync("initdb", ["-D", `${root}/data`, "-A", "trust", "-U", "postgres"], { stdio: "ignore" });
    execFileSync("pg_ctl", ["-D", `${root}/data`, "-l", `${root}/postgres.log`,
      "-o", `-k ${root} -h '' -c shared_buffers=64MB -c work_mem=4MB`, "-w", "start"], { stdio: "ignore" });
    started = true;
    pool = new pg.Pool({ host: root, user: "postgres", database: "postgres", max: 4, connectionTimeoutMillis: 1000 });
    expect((await pool.query("SELECT current_database() AS name")).rows[0].name).toBe("postgres");
    await pool.query(`
      CREATE TABLE workers(id varchar PRIMARY KEY, contact_id varchar, sirius_id varchar);
      CREATE TABLE contacts(id varchar PRIMARY KEY, given varchar, family varchar);
      ALTER TABLE workers ADD COLUMN ssn varchar;
      ALTER TABLE contacts ADD COLUMN email varchar, ADD COLUMN middle varchar,
        ADD COLUMN birth_date date, ADD COLUMN gender varchar;
      CREATE TABLE options_gender(id varchar PRIMARY KEY, code varchar);
      CREATE TABLE options_worker_relation_type(id varchar PRIMARY KEY, sirius_id varchar);
      INSERT INTO options_worker_relation_type VALUES ('child','C');
      CREATE TABLE contact_postal(id varchar PRIMARY KEY,contact_id varchar,street text,street2 text,
        city text,state text,postal_code text,is_active boolean,is_primary boolean);
      CREATE TABLE contact_phone(id varchar PRIMARY KEY,contact_id varchar,phone_number text,is_active boolean,is_primary boolean);
      CREATE TABLE employers(id varchar PRIMARY KEY, sirius_id varchar, name varchar);
      CREATE TABLE options_trust_benefit_type(id varchar PRIMARY KEY, name text);
      CREATE TABLE trust_benefits(id varchar PRIMARY KEY, sirius_id varchar, name varchar, benefit_type varchar);
      CREATE TABLE worker_relations(id varchar PRIMARY KEY, worker_1 varchar, worker_2 varchar, relation_type varchar,
        start_ymd date, end_ymd date, data jsonb);
      CREATE TABLE trust_wmb(id varchar PRIMARY KEY, worker_id varchar, employer_id varchar, benefit_id varchar,
        year int, month int, source_relation_id varchar);
      CREATE UNIQUE INDEX baseline_wmb ON trust_wmb(month,year,worker_id,employer_id,benefit_id);
      CREATE TABLE trust_wmb_events(id varchar PRIMARY KEY, worker_id varchar, benefit_id varchar,
        year int, month int, event_type varchar, data jsonb);
      CREATE TABLE trust_wmb_scan_queue(id varchar PRIMARY KEY, worker_id varchar, year int,
        month int, status varchar, result_summary jsonb, completed_at timestamp);
      INSERT INTO employers VALUES ('ordinary','100','Fictional employer'),('cobra','COBRA','Fictional COBRA');
      INSERT INTO options_trust_benefit_type VALUES ('medical','Medical');
      INSERT INTO trust_benefits VALUES ('eap','CARELONEAP','Fictional EAP',null),('med','M','Fictional medical','medical');
      INSERT INTO trust_wmb
      SELECT 'history-'||w||'-'||m, 'worker-'||w, 'ordinary','eap',
        (24203+m)/12, (24203+m)%12+1, null
      FROM generate_series(1,1000) w CROSS JOIN generate_series(0,119) m;
      INSERT INTO trust_wmb
      SELECT 'unrelated-'||w||'-'||m, 'unrelated-'||w, 'ordinary','med',
        2010+m/12,m%12+1,null
      FROM generate_series(1,2000) w CROSS JOIN generate_series(0,119) m;
      ANALYZE;
    `);
    const db = drizzle(pool);
    ctx = {
      configId: "fictional-carelon", configData: {}, providerId: null, sftpClientId: null,
      input: { asOfDate: "2026-11-15" }, terminationPolicy: { subscribers: true, dependents: true, months: 1 },
      storage: { readOnly: { query: (read: any, options?: { statementTimeoutMs: number }) => db.transaction(async tx => {
        queries++;
        await tx.execute(sql`SET TRANSACTION READ ONLY`);
        await tx.execute(sql`select set_config('statement_timeout', ${String(options?.statementTimeoutMs ?? 10_000)}, true)`);
        if (queryDelayMs) await new Promise(resolve => setTimeout(resolve, queryDelayMs));
        return read(tx);
      }) } },
    } as unknown as TrustProviderEdiContext;
  }, 60_000);
  afterAll(async () => {
    lastReview?.dispose();
    await pool?.end();
    if (started) execFileSync("pg_ctl", ["-D", `${root}/data`, "-m", "immediate", "-w", "stop"], { stdio: "ignore" });
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it("ingests relevant history without transferring unrelated medical history and keeps HTTP responsive", async () => {
    // Supplied incident pages took 95–104ms per ~100 rows. Add that full
    // latency on top of real local SQL; do not substitute mocked evidence.
    queryDelayMs = 100;
    const server = createServer(async (_req, res) => {
      try { await pool.query("SELECT 1"); res.end("ready"); }
      catch { res.statusCode = 503; res.end("unavailable"); }
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as { port: number };
    const loop = monitorEventLoopDelay({ resolution: 10 });
    loop.enable();
    const baseline = process.memoryUsage();
    let peakRss = baseline.rss, peakHeap = baseline.heapUsed, maxHttpMs = 0, requests = 0;
    let stop = false;
    const polling = (async () => {
      while (!stop) {
        const t = performance.now();
        const response = await fetch(`http://127.0.0.1:${address.port}/status`);
        expect(await response.text()).toBe("ready");
        expect(response.status).toBe(200);
        maxHttpMs = Math.max(maxHttpMs, performance.now() - t); requests++;
        const memory = process.memoryUsage();
        peakRss = Math.max(peakRss, memory.rss); peakHeap = Math.max(peakHeap, memory.heapUsed);
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    })();
    const t = performance.now();
    const queryStart = queries;
    try {
      const plan = await pool.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
        SELECT id FROM trust_wmb WHERE worker_id='worker-1' AND benefit_id='eap'
        AND year=2026 AND month=11 ORDER BY id LIMIT 1000`);
      const batchPlan = await pool.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
        SELECT w.id FROM trust_wmb w WHERE w.year=2026 AND w.month=10 AND w.benefit_id='eap'
        AND (w.worker_id,w.benefit_id,w.year,w.month) IN
        (VALUES ${Array.from({ length: 1000 }, (_, i) => `('worker-${i + 1}'::varchar,'eap'::varchar,2026,10)`).join(",")})
        ORDER BY w.id LIMIT 1000`);
      const review = await discoverCoverage(ctx, plugin);
      expect(review.relevant.size).toBe(120_000);
      expect(review.conflicts).toEqual([]);
      const projection = await coverageProjection(review);
      const index = coverageProjectionIndex(projection)!;
      const current = review.relevant.get("history-1-119")!;
      expect(index.segments.start(current)).toBe("2016-12-01");
      for (const row of review.relevant.values()) expect(row.benefitId).toBe("eap");
      expect(maxHttpMs).toBeLessThan(1000);
      expect(requests).toBeGreaterThan(2);
      mkdirSync("generated-artifacts", { recursive: true });
      writeFileSync("generated-artifacts/edi-ingestion-measurements.json", JSON.stringify({
        durationMs: Math.round(performance.now() - t), rows: review.relevant.size,
        queries: queries - queryStart,
        injectedQueryDelayMs: queryDelayMs,
        peakRss, peakHeap, rssGrowth: peakRss - baseline.rss, heapGrowth: peakHeap - baseline.heapUsed,
        eventLoopMaxMs: loop.max / 1e6, maxHttpMs, requests,
        coordinatePlan: plan.rows[0]["QUERY PLAN"],
        batchPlan: batchPlan.rows[0]["QUERY PLAN"],
      }, null, 2));
    } finally {
      queryDelayMs = 0;
      stop = true; await polling; loop.disable();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  }, 150_000);

  it("checks long family histories without retaining wide relation metadata", async () => {
    await pool.query(`
      INSERT INTO worker_relations SELECT 'long-rel-'||n,'long-parent-'||n,'long-child-'||n,'child',null,null,
        jsonb_build_object('fixture',repeat('x',200000)) FROM generate_series(1,550) n;
      INSERT INTO trust_wmb
      SELECT 'long-'||role||'-'||w||'-'||m, 'long-'||role||'-'||w, 'ordinary','eap',
        2031+m/12,m%12+1,CASE WHEN role='child' THEN 'long-rel-'||w ELSE null END
      FROM generate_series(1,550) w CROSS JOIN generate_series(0,119) m
      CROSS JOIN (VALUES ('parent'),('child')) roles(role);
      INSERT INTO contacts(id,given,family)
        SELECT DISTINCT worker_id,'Fictional','Fixture' FROM trust_wmb WHERE id LIKE 'long-%';
      INSERT INTO workers(id,contact_id,sirius_id)
        SELECT id,id,id FROM contacts;
      INSERT INTO worker_relations VALUES ('shared-family','long-parent-1','long-child-550','child',null,null,null);
      INSERT INTO trust_wmb VALUES ('competing-old-child','long-child-550','cobra','eap',2036,1,'shared-family');
      ANALYZE;
    `);
    const run = { ...ctx, input: { asOfDate: "2040-12-01" } };
    queryDelayMs = 100;
    const baseline = process.memoryUsage();
    let peakRss = baseline.rss, peakHeap = baseline.heapUsed, requests = 0, maxHttpMs = 0;
    const server = createServer(async (_req, res) => { await pool.query("SELECT 1"); res.end("ready"); });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as { port: number };
    let stopped = false;
    const polling = (async () => {
      while (!stopped) {
        const start = performance.now();
        const response = await fetch(`http://127.0.0.1:${address.port}/status`);
        expect(await response.text()).toBe("ready");
        maxHttpMs = Math.max(maxHttpMs, performance.now() - start);
        requests++;
        const memory = process.memoryUsage();
        peakRss = Math.max(peakRss, memory.rss); peakHeap = Math.max(peakHeap, memory.heapUsed);
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    })();
    const start = performance.now(), queryStart = queries;
    try {
      const familyPlan = await pool.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
        SELECT w.id FROM trust_wmb w JOIN worker_relations r ON w.source_relation_id=r.id
        WHERE w.year=2040 AND w.month=12 AND w.benefit_id='eap'
        AND (r.worker_1,w.benefit_id,w.year,w.month) IN
        (VALUES ${Array.from({ length: 400 }, (_, i) => `('long-parent-${i + 1}'::varchar,'eap'::varchar,2040,12)`).join(",")})
        ORDER BY w.id LIMIT 1000`);
      const review = await discoverCoverage(run, plugin);
      expect(review.relevant.size).toBe(132_001);
      expect(review.relationMap.size).toBe(551);
      expect(review.conflicts).toHaveLength(1);
      const conflict = review.conflicts[0];
      expect(conflict.candidates).toHaveLength(2);
      conflict.decision = approveConflict(conflict, {
        evidence: conflict.evidence, selectedId: "long-child-550-60", reason: "Fictional family-source verification",
      }, "fixture-admin", "2040-12-01T00:00:00Z");
      expect(JSON.stringify([...review.relationMap.values()]).length).toBeLessThan(200_000);
      const projection = await coverageProjection(review);
      const current = review.relevant.get("long-child-1-119")!;
      expect(coverageProjectionIndex(projection)!.segments.start(current)).toBe("2031-01-01");
      const generationContext = { ...run, coverageProjection: projection };
      const keys = await plugin.getPrimaryKeys!(generationContext);
      expect(keys).toHaveLength(550);
      let generated = 0;
      for (let offset = 0; offset < keys.length; offset += 100) {
        const rows = await plugin.processBatch(keys.slice(offset, offset + 100), generationContext);
        generated += rows.length;
        for (const row of rows) expect(plugin.encodeRow(row, generationContext)).toBeTruthy();
      }
      expect(generated).toBe(1100);
      expect(maxHttpMs).toBeLessThan(1000);
      expect(requests).toBeGreaterThan(2);
      mkdirSync("generated-artifacts", { recursive: true });
      writeFileSync("generated-artifacts/edi-family-measurements.json", JSON.stringify({
        durationMs: Math.round(performance.now() - start), rows: review.relevant.size, queries: queries - queryStart,
        injectedQueryDelayMs: queryDelayMs,
        peakRss, peakHeap, maxHttpMs, requests, generated, familyPlan: familyPlan.rows[0]["QUERY PLAN"],
      }, null, 2));
      const fingerprint = review.fingerprint;
      const decisions = projection.decisions;
      queryDelayMs = 0;
      await pool.query("UPDATE trust_wmb SET employer_id='changed-rejected-employer' WHERE id='competing-old-child'");
      const changed = await discoverCoverage(run, plugin, decisions);
      expect(changed.fingerprint).not.toBe(fingerprint);
      expect(changed.conflicts[0].stale).toBe(true);
      await expect(coverageProjection(changed)).rejects.toThrow(/stale/);
    } finally {
      queryDelayMs = 0;
      stopped = true; await polling;
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
    // Digest changes must invalidate even non-authoritative metadata edits.
    const one = { ...ctx, input: { asOfDate: "2031-01-01" } };
    const before = await discoverCoverage(one, plugin);
    await pool.query(`UPDATE worker_relations SET data='{"fixture":"changed"}' WHERE id='long-rel-1'`);
    const after = await discoverCoverage(one, plugin);
    expect(after.fingerprint).not.toBe(before.fingerprint);
  }, 240_000);

  it("caches complete and empty coordinates but never treats a family subset as complete", async () => {
    const reader = coverageReader(ctx, new CoverageBudget());
    const coordinate = { workerId: "worker-1", benefitId: "eap", year: 2026, month: 11 };
    await reader.ensure([coordinate]);
    const completeCount = queries;
    await reader.ensure([coordinate, coordinate]);
    expect(queries).toBe(completeCount);
    const empty = { ...coordinate, workerId: "absent" };
    await reader.ensure([empty]);
    const emptyCount = queries;
    await reader.ensure([empty]);
    expect(queries).toBe(emptyCount);
    await pool.query(`INSERT INTO worker_relations VALUES ('subset-rel','subset-parent','subset-child','child',null,null,null);
      INSERT INTO trust_wmb VALUES ('subset-one','subset-child','ordinary','eap',2041,1,'subset-rel'),
        ('subset-other','subset-child','cobra','eap',2041,1,null);`);
    await reader.ensure([{ ...coordinate, workerId: "subset-parent", year: 2041, month: 1 }], true);
    await reader.ensure([{ ...coordinate, workerId: "subset-child", year: 2041, month: 1 }]);
    expect(reader.groups.get("subset-child|eap|2041-01")).toHaveLength(2);
    reader.dispose();
  });

  it("preserves duplicate family candidates and future reinstatement in real SQL", async () => {
    await pool.query(`
      INSERT INTO worker_relations SELECT 'rel-'||n,'fan-parent','fan-child-'||n,'child',null,null,null FROM generate_series(1,1000) n;
      INSERT INTO trust_wmb SELECT 'fan-parent-'||n,'fan-parent','employer-'||n,'eap',2027,1,null FROM generate_series(1,500) n;
      INSERT INTO trust_wmb SELECT 'fan-child-'||n,'fan-child-'||n,'ordinary','eap',2027,1,'rel-'||n FROM generate_series(1,1000) n;
      INSERT INTO trust_wmb VALUES ('ended','ended','ordinary','eap',2026,12,null),
        ('reinstated','ended','ordinary','eap',2027,3,null);
      INSERT INTO trust_wmb_events VALUES ('end-event','ended','eap',2027,1,'terminate','{"provenance":"coverage_inferred"}');
    `);
    const run = { ...ctx, input: { asOfDate: "2027-01-01" } };
    const review = await discoverCoverage(run, plugin);
    expect(review.relevant.size).toBe(1500);
    expect(review.conflicts).toEqual([]);
    expect(review.events).toEqual([]);
    expect(coverageProjectionIndex(await coverageProjection(review))!.byId.size).toBe(1500);
    await pool.query("DELETE FROM trust_wmb WHERE id='reinstated'");
    const changed = await discoverCoverage(run, plugin);
    expect(changed.events).toHaveLength(1);
    expect(changed.relevant.size).toBe(1501);
    expect(changed.fingerprint).not.toBe(review.fingerprint);
  }, 60_000);

  it("refuses excess evidence and releases discovery admission for the next attempt", async () => {
    await pool.query(`INSERT INTO trust_wmb
      SELECT 'oversized-'||n,'oversized-person-'||n,'ordinary','eap',2070,1,null
      FROM generate_series(1,125001) n; ANALYZE trust_wmb;`);
    const oversized = { ...ctx, input: { asOfDate: "2070-01-01" },
      coverageCorrelation: { wizardId: "fictional-wizard", runId: "fictional-run" } };
    const clock = vi.spyOn(performance, "now");
    const now = performance.now();
    clock.mockReturnValueOnce(now).mockReturnValue(now + COVERAGE_LIMITS.durationMs + 1);
    try { await expect(discoverCoverage(oversized, plugin)).rejects.toBeInstanceOf(CoverageBudgetError); }
    finally { clock.mockRestore(); }
    const empty = { ...ctx, input: { asOfDate: "2030-01-01" }, terminationPolicy: { subscribers: false, dependents: false, months: 1 } };
    expect((await discoverCoverage(empty, plugin)).relevant.size).toBe(0);
  }, 60_000);

  it("carries only applicable endings through discovery, projection and key generation for every role combination", async () => {
    await pool.query(`
      INSERT INTO worker_relations VALUES ('role-relation','role-parent','role-child','child',null,null,null);
      INSERT INTO trust_wmb VALUES
        ('role-parent-oct','role-parent','ordinary','eap',2028,10,null),
        ('role-parent-nov','role-parent','ordinary','eap',2028,11,null),
        ('role-child-oct','role-child','ordinary','eap',2028,10,'role-relation'),
        ('role-ended-sub-oct','role-ended-sub','ordinary','eap',2028,10,null);
      INSERT INTO trust_wmb_events VALUES
        ('role-child-end','role-child','eap',2028,11,'terminate','{"provenance":"coverage_inferred"}'),
        ('role-sub-end','role-ended-sub','eap',2028,11,'terminate','{"provenance":"coverage_inferred"}');
    `);
    for (const subscribers of [false, true]) for (const dependents of [false, true]) {
      const run = { ...ctx, input: { asOfDate: "2028-11-01" },
        terminationPolicy: { subscribers, dependents, months: 1 } };
      const review = await discoverCoverage(run, plugin);
      const keys = await plugin.getPrimaryKeys!({ ...run, coverageProjection: await coverageProjection(review) });
      expect(keys.sort()).toEqual([
        "role-parent-nov",
        ...(subscribers ? ["termination:role-sub-end"] : []),
        ...(dependents ? ["termination:role-child-end"] : []),
      ].sort());
    }
    // A missing last-covered row cannot be treated as proof of a disabled
    // role; there is no authoritative source with which to classify it.
    await pool.query(`INSERT INTO trust_wmb_events VALUES
      ('role-missing','missing','eap',2028,11,'terminate','{"provenance":"coverage_inferred"}')`);
    const run = { ...ctx, input: { asOfDate: "2028-11-01" },
      terminationPolicy: { subscribers: true, dependents: false, months: 1 } };
    const review = await discoverCoverage(run, plugin);
    await expect(plugin.getPrimaryKeys!({ ...run, coverageProjection: await coverageProjection(review) }))
      .rejects.toThrow(/last-covered WMB evidence is missing/);
  });
});
