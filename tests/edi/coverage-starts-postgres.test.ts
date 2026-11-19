import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { readSegmentConflicts, readSegmentStarts } from "../../server/plugins/trust/provider-edi/coverage-starts";
import { assertCoverageEventsReady, CoverageEventsNotReadyError } from "../../server/plugins/trust/provider-edi/coverage-readiness";
import type { TrustProviderEdiContext } from "../../server/plugins/trust/provider-edi/registry";
import { sql, type SQL } from "drizzle-orm";
import { coverageDatabaseFailure, CoverageDatabaseError } from "../../server/plugins/trust/provider-edi/coverage-database-error";

// Explicit opt-in (EDI_COVERAGE_STARTS_PG=1); starts an isolated local cluster
// with no TCP listener and never reads DATABASE_URL. Requires PostgreSQL
// initdb/pg_ctl on PATH. This is where the start-date rule itself runs: the
// statement aggregates each person's run in the database.
describe.skipIf(process.env.EDI_COVERAGE_STARTS_PG !== "1")("segment start statement on real PostgreSQL", () => {
  let root: string;
  let pool: pg.Pool;
  let started = false;
  const index = (month: number) => 2026 * 12 + month - 1;
  /** One person per case, all in 2026: months as [month, employer, source relation]. */
  const people: Record<string, { restarts: number[]; months: [number, "ordinary" | "cobra", string | null][] }> = {
    continuous: { restarts: [3], months: [3, 4, 5, 6, 7, 8, 9, 10].map(m => [m, "ordinary", null]) },
    gap: { restarts: [1, 7], months: [1, 2, 3, 4, 5, 7, 8, 9, 10].map(m => [m, "ordinary", null]) },
    source: { restarts: [3], months: [3, 4, 5, 6, 7, 8, 9, 10].map(m => [m, "ordinary", m < 7 ? "relation" : null]) },
    cobra: { restarts: [3], months: [3, 4, 5, 6, 7, 8, 9, 10].map(m => [m, m < 8 ? "ordinary" : "cobra", null]) },
    conflict: { restarts: [3], months: [...[3, 4, 5, 6, 7, 8, 9, 10].map(m => [m, "ordinary", null] as [number, "ordinary", null]),
      [6, "cobra", null]] },
    // Conflicting in April, then a dependent source through June: the conflict lies before the segment.
    earlier: { restarts: [3], months: [...[3, 4, 5, 6, 7, 8, 9, 10].map(m => [m, "ordinary", m < 7 ? "relation" : null] as [number, "ordinary", string | null]),
      [4, "cobra", null]] },
    missing: { restarts: [], months: [9, 10].map(m => [m, "ordinary", null]) },
    behind: { restarts: [3], months: [3, 4, 6, 7, 8, 9, 10].map(m => [m, "ordinary", null]) },
    ended: { restarts: [3, 10], months: [3, 4, 5, 6, 7, 8, 10].map(m => [m, "ordinary", null]) },
  };
  const wmbId = (person: string, month: number, employer = "ordinary") => `${person}-${month}-${employer}`;
  beforeAll(async () => {
    root = mkdtempSync(path.join(tmpdir(), "edi-starts-pg-"));
    execFileSync("initdb", ["-D", `${root}/data`, "-A", "trust", "-U", "postgres"], { stdio: "ignore" });
    execFileSync("pg_ctl", ["-D", `${root}/data`, "-l", `${root}/postgres.log`, "-o", `-k ${root} -h ''`, "-w", "start"], { stdio: "ignore" });
    started = true;
    pool = new pg.Pool({ host: root, user: "postgres", database: "postgres", max: 2 });
    await pool.query(`
      CREATE TABLE employers (id varchar PRIMARY KEY, sirius_id varchar);
      CREATE TABLE trust_wmb (id varchar PRIMARY KEY, worker_id varchar NOT NULL, benefit_id varchar NOT NULL,
        year integer NOT NULL, month integer NOT NULL, employer_id varchar NOT NULL, source_relation_id varchar);
      CREATE TABLE trust_wmb_events (id serial PRIMARY KEY, worker_id varchar NOT NULL, benefit_id varchar NOT NULL,
        year integer NOT NULL, month integer NOT NULL, event_type varchar NOT NULL);
      CREATE TYPE denorm_status AS ENUM ('ok', 'stale', 'error');
      CREATE TABLE denorm (id varchar PRIMARY KEY, entity_id varchar NOT NULL, config_id varchar NOT NULL,
        status denorm_status NOT NULL);
      CREATE UNIQUE INDEX denorm_entity_config_uniq ON denorm(entity_id, config_id);
      INSERT INTO employers VALUES ('ordinary', '100'), ('cobra', '13226164');`);
    for (const [person, { restarts, months }] of Object.entries(people)) {
      for (const [month, employer, source] of months)
        await pool.query("INSERT INTO trust_wmb VALUES ($1, $2, 'benefit', 2026, $3, $4, $5)",
          [wmbId(person, month, employer), person, month, employer, source]);
      for (const month of restarts)
        await pool.query("INSERT INTO trust_wmb_events (worker_id, benefit_id, year, month, event_type) VALUES ($1, 'benefit', 2026, $2, 'restart')", [person, month]);
      // Other benefits and other event types must not move the start.
      await pool.query("INSERT INTO trust_wmb_events (worker_id, benefit_id, year, month, event_type) VALUES ($1, 'benefit', 2026, 9, 'terminate'), ($1, 'other-benefit', 2026, 9, 'restart')", [person]);
    }
    // Coverage older than every run: read by no anchor.
    for (const person of Object.keys(people)) for (const month of [1, 2, 3, 4, 5, 6])
      await pool.query("INSERT INTO trust_wmb VALUES ($1, $2, 'benefit', 2024, $3, 'ordinary', NULL)", [`${person}-old-${month}`, person, month]);
    await pool.query(`INSERT INTO trust_wmb VALUES
      ('r-ready-feb', 'r-ready', 'readiness', 2026, 2, 'ordinary', NULL),
      ('r-ready-mar', 'r-ready', 'readiness', 2026, 3, 'ordinary', NULL),
      ('r-ready-duplicate', 'r-ready', 'readiness', 2026, 3, 'cobra', NULL),
      ('r-missing', 'r-missing', 'readiness', 2026, 2, 'ordinary', NULL),
      ('r-pending', 'r-pending', 'readiness', 2026, 3, 'ordinary', NULL),
      ('r-failed', 'r-failed', 'readiness', 2026, 3, 'ordinary', NULL),
      ('r-outside-jan', 'r-outside', 'readiness', 2026, 1, 'ordinary', NULL),
      ('r-outside-apr', 'r-outside', 'readiness', 2026, 4, 'ordinary', NULL),
      ('r-outside-year', 'r-outside', 'readiness', 2025, 3, 'ordinary', NULL),
      ('r-outside-benefit', 'r-outside', 'other', 2026, 3, 'ordinary', NULL)`);
  }, 30_000);
  afterAll(async () => {
    await pool?.end();
    if (started) execFileSync("pg_ctl", ["-D", `${root}/data`, "-m", "immediate", "-w", "stop"], { stdio: "ignore" });
    if (root) rmSync(root, { recursive: true, force: true });
  });

  const read = async (...ids: string[]) => {
    const starts = await readSegmentStarts(drizzle(pool) as never, ids);
    return new Map(starts.map(start => [start.id, start]));
  };

  const readinessContext = (plans?: string[]) => ({
    storage: {
      pluginConfigs: { getByKindAndPlugin: async (_kind: string, pluginId: string) =>
        [{ id: pluginId, enabled: true }] },
      denorm: { countByStatusForConfig: async () => ({ total: 1 }) },
      readOnly: { query: async (fn: (db: ReturnType<typeof drizzle>) => Promise<unknown>, options: { statementTimeoutMs: number }) => {
        return drizzle(pool).transaction(async tx => {
          await tx.execute(sql`SET TRANSACTION READ ONLY`);
          await tx.execute(sql`select set_config('statement_timeout', ${String(options.statementTimeoutMs)}, true)`);
          return fn({ execute: async (statement: SQL) => {
            if (plans) {
              const result = await tx.execute(sql`EXPLAIN (ANALYZE, BUFFERS, TIMING OFF) ${statement}`);
              plans.push(...result.rows.map(row => String(row["QUERY PLAN"])));
            }
            return tx.execute(statement);
          } } as never);
        });
      } },
    },
  }) as unknown as TrustProviderEdiContext;

  it.each([false, true])("executes February–March readiness (terminations=%s)", async terminations => {
    await pool.query(`INSERT INTO denorm (id, entity_id, config_id, status)
      SELECT p.worker_id || c.id, p.worker_id, c.id, 'ok'
      FROM (SELECT DISTINCT worker_id FROM trust_wmb) p
      CROSS JOIN (VALUES ('trust-wmb-restart'), ('trust-wmb-terminate')) c(id)
      ON CONFLICT DO NOTHING`);
    await expect(assertCoverageEventsReady(readinessContext(), ["benefit"], index(2), index(3), terminations))
      .resolves.toEqual({ population: 8 });
  });

  it("classifies distinct missing, pending and failed people without admitting other months or benefits", async () => {
    await pool.query(`DELETE FROM denorm WHERE entity_id LIKE 'r-%';
      INSERT INTO denorm VALUES
      ('r-ready-status', 'r-ready', 'trust-wmb-restart', 'ok'),
      ('r-pending-status', 'r-pending', 'trust-wmb-restart', 'stale'),
      ('r-failed-status', 'r-failed', 'trust-wmb-restart', 'error')`);
    const error = await assertCoverageEventsReady(readinessContext(), ["readiness"], index(2), index(3), false).catch(e => e);
    expect(error).toBeInstanceOf(CoverageEventsNotReadyError);
    expect(error.message).toContain("of 4 people");
    expect(error.message).toContain("coverage start (restart) events are missing for 1 person, pending for 1 person, failed for 1 person");
    expect(error.message).not.toContain("terminate");
    // Termination maintenance becomes required only when either termination role is enabled.
    const both = await assertCoverageEventsReady(readinessContext(), ["readiness"], index(2), index(3), true).catch(e => e);
    expect(both.message).toContain("coverage end (terminate) events are missing for 4 people");
  });

  it("refuses stale termination maintenance even when every restart is ready, then succeeds after maintenance", async () => {
    await pool.query(`DELETE FROM denorm WHERE entity_id LIKE 'r-%';
      INSERT INTO denorm
      SELECT p.worker_id || c.id, p.worker_id, c.id,
        CASE WHEN c.id = 'trust-wmb-terminate' THEN 'stale' ELSE 'ok' END::denorm_status
      FROM (SELECT DISTINCT worker_id FROM trust_wmb WHERE benefit_id='readiness' AND year=2026 AND month IN (2,3)) p
      CROSS JOIN (VALUES ('trust-wmb-restart'), ('trust-wmb-terminate')) c(id)`);
    await expect(assertCoverageEventsReady(readinessContext(), ["readiness"], index(2), index(3), false))
      .resolves.toEqual({ population: 4 });
    await expect(assertCoverageEventsReady(readinessContext(), ["readiness"], index(2), index(3), true))
      .rejects.toThrow("coverage end (terminate) events are pending for 4 people");
    await pool.query("UPDATE denorm SET status='ok' WHERE entity_id LIKE 'r-%'");
    await expect(assertCoverageEventsReady(readinessContext(), ["readiness"], index(2), index(3), true))
      .resolves.toEqual({ population: 4 });
  });

  it.each([false, true])("accepts an empty population without inventing readiness rows (terminations=%s)", async terminations => {
    await expect(assertCoverageEventsReady(readinessContext(), ["no-such-benefit"], index(2), index(3), terminations))
      .resolves.toEqual({ population: 0 });
  });

  it("extracts a real PostgreSQL cause from Drizzle without relaying SQL to staff", async () => {
    await pool.query("ALTER TABLE denorm RENAME TO denorm_unavailable");
    try {
      const raw = await assertCoverageEventsReady(readinessContext(), ["benefit"], index(2), index(3), true).catch(e => e);
      expect(raw.cause.code).toBe("42P01");
      const safe = coverageDatabaseFailure(raw, "Checking lifecycle events", 0) as CoverageDatabaseError;
      expect(safe).toBeInstanceOf(CoverageDatabaseError);
      expect(safe.diagnostics.code).toBe("42P01");
      expect(safe.message).toContain("a required database table is unavailable");
      expect(safe.message).not.toMatch(/SELECT|WITH population|params:|24313/);
    } finally {
      await pool.query("ALTER TABLE denorm_unavailable RENAME TO denorm");
    }
  });

  it("measures the February–March aggregate with 60,000 people and unrelated history", async () => {
    await pool.query(`INSERT INTO trust_wmb
      SELECT 'scale-' || p || '-' || y || '-' || m, 'scale-' || p, 'scale-benefit', y, m, 'ordinary', NULL
      FROM generate_series(1, 60000) p CROSS JOIN generate_series(2025, 2026) y CROSS JOIN generate_series(1, 12) m;
      INSERT INTO denorm
      SELECT 'scale-' || p || c, 'scale-' || p, c, 'ok'::denorm_status
      FROM generate_series(1, 60000) p
      CROSS JOIN (VALUES ('trust-wmb-restart'), ('trust-wmb-terminate')) configs(c);
      ANALYZE trust_wmb; ANALYZE denorm;`);
    for (const terminations of [false, true]) {
      const plans: string[] = [];
      const context = readinessContext(plans);
      const started = performance.now();
      await expect(assertCoverageEventsReady(context, ["scale-benefit"], index(2), index(3), terminations))
        .resolves.toEqual({ population: 60000 });
      process.stdout.write(`Local synthetic readiness: people=60000 coverageRows=1440000 configs=${terminations ? 2 : 1} milliseconds=${Math.round(performance.now() - started)} (EXPLAIN ANALYZE plus query)\n${plans.join("\n")}\n`);
    }
  }, 60_000);

  it("applies the start-date rule to each kind of history", async () => {
    const anchors = {
      continuous: wmbId("continuous", 10), gap: wmbId("gap", 10), source: wmbId("source", 10),
      cobra: wmbId("cobra", 10, "cobra"), conflict: wmbId("conflict", 10), missing: wmbId("missing", 10),
      behind: wmbId("behind", 10), earlier: wmbId("earlier", 10),
    };
    const starts = await read(...Object.values(anchors));
    expect(starts.size).toBe(8);
    expect(starts.get(anchors.continuous)).toMatchObject({ coverageStartYmd: "2026-03-01", isCobra: false, problem: null, conflictMonths: 0, conflictRecords: 0 });
    // A gap: the later restart event is the start.
    expect(starts.get(anchors.gap)).toMatchObject({ coverageStartYmd: "2026-07-01", monthsRead: 4 });
    // Dependent source through June, own coverage from July.
    expect(starts.get(anchors.source)).toMatchObject({ coverageStartYmd: "2026-07-01", isCobra: false });
    // Non-COBRA through July, COBRA from August, no gap.
    expect(starts.get(anchors.cobra)).toMatchObject({ coverageStartYmd: "2026-08-01", isCobra: true });
    // A conflicting historical month holding a record of the member's own class.
    expect(starts.get(anchors.conflict)).toMatchObject({ coverageStartYmd: "2026-03-01", conflictMonths: 1, conflictRecords: 2 });
    // A conflict before the segment start is neither counted nor read.
    expect(starts.get(anchors.earlier)).toMatchObject({ coverageStartYmd: "2026-07-01", conflictMonths: 0, conflictRecords: 0 });
    // Only the conflicting month's records come back, never the rest of the run.
    const conflicts = await readSegmentConflicts(drizzle(pool) as never,
      Object.values(anchors).filter(id => starts.get(id)!.coverageStartYmd)
        .map(id => ({ id, coverageStartYmd: starts.get(id)!.coverageStartYmd! })));
    expect(conflicts.map(c => c.id).sort()).toEqual([wmbId("conflict", 6, "cobra"), wmbId("conflict", 6)]);
    expect(conflicts[0]).toMatchObject({ workerId: "conflict", benefitId: "benefit", year: 2026, month: 6 });
    expect(starts.get(anchors.missing)).toMatchObject({ coverageStartYmd: null, problem: "missing-event" });
    expect(starts.get(anchors.behind)).toMatchObject({ coverageStartYmd: null, problem: "inconsistent-event" });
    // Nothing older than a run start was aggregated, for anyone.
    for (const start of starts.values()) expect(start.monthsBeforeRunStart).toBe(0);
    expect(starts.get(anchors.continuous)!.monthsRead).toBe(8);
  });
  it("anchors a termination candidate on their last covered month, not on later coverage", async () => {
    const starts = await read(wmbId("ended", 8), wmbId("ended", 10));
    expect(starts.get(wmbId("ended", 8))).toMatchObject({ coverageStartYmd: "2026-03-01", monthsRead: 6 });
    expect(starts.get(wmbId("ended", 10))).toMatchObject({ coverageStartYmd: "2026-10-01", monthsRead: 1 });
  });
});
