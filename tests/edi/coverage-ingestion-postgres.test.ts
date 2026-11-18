import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import { monitorEventLoopDelay } from "node:perf_hooks";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { discoverCoverage, coverageProjection } from "../../server/plugins/trust/provider-edi/coverage-review";
import { coverageProjectionIndex } from "../../server/plugins/trust/provider-edi/coverage-choices";
import { registeredEdiPlugins } from "./fixtures/harness";
import type { TrustProviderEdiContext } from "../../server/plugins/trust/provider-edi/registry";
import { CoverageBudget, COVERAGE_LIMITS } from "../../server/plugins/trust/provider-edi/coverage-budget";

// Opt-in production-shaped ingestion measurement. No app URL, database, member
// record, carrier generation or delivery is touched.
describe.skipIf(process.env.EDI_COVERAGE_PG !== "1").sequential("bounded PostgreSQL coverage ingestion", () => {
  let root: string;
  let pool: pg.Pool;
  let ctx: TrustProviderEdiContext;
  let started = false;
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
        await tx.execute(sql`SET TRANSACTION READ ONLY`);
        await tx.execute(sql`select set_config('statement_timeout', ${String(options?.statementTimeoutMs ?? 10_000)}, true)`);
        return read(tx);
      }) } },
    } as unknown as TrustProviderEdiContext;
  }, 60_000);
  afterAll(async () => {
    await pool?.end();
    if (started) execFileSync("pg_ctl", ["-D", `${root}/data`, "-m", "immediate", "-w", "stop"], { stdio: "ignore" });
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it("ingests relevant history without transferring unrelated medical history and keeps HTTP responsive", async () => {
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
    try {
      const plan = await pool.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
        SELECT id FROM trust_wmb WHERE worker_id='worker-1' AND benefit_id='eap'
        AND year=2026 AND month=11 ORDER BY id LIMIT 1000`);
      const review = await discoverCoverage(ctx, plugin);
      expect(review.relevant).toHaveLength(120_000);
      expect(review.conflicts).toEqual([]);
      const projection = coverageProjection(review);
      const index = coverageProjectionIndex(projection)!;
      const current = review.relevant.find(r => r.workerId === "worker-1" && r.year === 2026 && r.month === 11)!;
      expect(index.segments.start(current)).toBe("2016-12-01");
      expect(review.relevant.every(r => r.benefitId === "eap")).toBe(true);
      expect(maxHttpMs).toBeLessThan(1000);
      expect(requests).toBeGreaterThan(2);
      mkdirSync("generated-artifacts", { recursive: true });
      writeFileSync("generated-artifacts/edi-ingestion-measurements.json", JSON.stringify({
        durationMs: Math.round(performance.now() - t), rows: review.relevant.length,
        peakRss, peakHeap, rssGrowth: peakRss - baseline.rss, heapGrowth: peakHeap - baseline.heapUsed,
        eventLoopMaxMs: loop.max / 1e6, maxHttpMs, requests,
        coordinatePlan: plan.rows[0]["QUERY PLAN"],
      }, null, 2));
    } finally {
      stop = true; await polling; loop.disable();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  }, 150_000);

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
    expect(review.relevant).toHaveLength(1500);
    expect(review.conflicts).toEqual([]);
    expect(review.events).toEqual([]);
    expect(coverageProjectionIndex(coverageProjection(review))!.byId.size).toBe(1500);
    await pool.query("DELETE FROM trust_wmb WHERE id='reinstated'");
    const changed = await discoverCoverage(run, plugin);
    expect(changed.events).toHaveLength(1);
    expect(changed.relevant).toHaveLength(1501);
    expect(changed.fingerprint).not.toBe(review.fingerprint);
  }, 60_000);

  it("refuses excess evidence and releases discovery admission for the next attempt", async () => {
    const retain = vi.spyOn(CoverageBudget.prototype, "retain").mockImplementation(() => {
      throw new Error("Coverage evidence exceeded its safe resource budget");
    });
    try { await expect(discoverCoverage(ctx, plugin)).rejects.toThrow(/resource budget/); }
    finally { retain.mockRestore(); }
    const budget = new CoverageBudget();
    expect(() => budget.check(COVERAGE_LIMITS.keys + 1)).toThrow(/resource budget/);
    for (let i = 0; i < COVERAGE_LIMITS.rows; i++) budget.retain({});
    expect(() => budget.retain({})).toThrow(/resource budget/);
    const empty = { ...ctx, input: { asOfDate: "2030-01-01" }, terminationPolicy: { subscribers: false, dependents: false, months: 1 } };
    expect((await discoverCoverage(empty, plugin)).relevant).toEqual([]);
  });

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
      const keys = await plugin.getPrimaryKeys!({ ...run, coverageProjection: coverageProjection(review) });
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
    await expect(plugin.getPrimaryKeys!({ ...run, coverageProjection: coverageProjection(review) }))
      .rejects.toThrow(/last-covered WMB evidence is missing/);
  });
});
