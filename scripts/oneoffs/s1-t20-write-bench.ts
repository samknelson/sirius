/**
 * T20 write bench (Task 356) — WET, production-shaped benchmark of the
 * migration bulk write path in scripts/s1-migration/load-hours.ts.
 *
 * The wet production-profile rehearsal measured the legacy per-row storage
 * path at ~45 staged payperiods/s (~22 h for the full 3.6M-row T20 phase).
 * This bench seeds a production-shaped staged corpus (default 100k payperiod
 * rows: biweekly periods, 18 per worker across 9 months, 50 employers —
 * ~0.5 month-groups per staged row, mirroring the rehearsal's aggregation
 * ratio), then runs the REAL loader twice as a CLI child under a hard
 * 512 MB heap cap:
 *   run1 — insert-heavy (all bench groups are new rows)
 *   run2 — rerun (all bench groups take the conflict-update path)
 *
 * Gates (all must hold for exit 0):
 *   - both runs exit 0, verify pass, written == verified, 0 mismatches
 *   - written == devBaseline + expectedGroups (exact group parity)
 *   - run1 createdRows == expectedGroups; run2 createdRows == 0
 *   - SUM(hours) over bench workers == 80 × staged bench rows (exact)
 *   - sidecar stamped exactly once per bench group
 *   - zero ledger delta (no migration-generated charges; a paranoid check —
 *     the loader also fail-closes on suppression)
 *   - writeGroupsPerSec ≥ RATE_GATE (450 = 10× the observed 45/s) both runs
 *   - projected full T20 phase (3.6M staged rows at measured scan + write +
 *     verify rates) ≤ PROJECTION_GATE_S (9000 s ≈ 2.5 h) both runs
 *
 * Seeds nids at 96,000,000+ (trackc-bench owns 90M+; ranges are disjoint)
 * and removes everything it created afterwards — cleanup runs first (stale
 * rows from an aborted run), in a `finally`, and via --cleanup-only.
 * Aggregates only — no PII.
 *
 * Usage: npx tsx scripts/oneoffs/s1-t20-write-bench.ts [--cleanup-only]
 *        BENCH_N=20000 npx tsx scripts/oneoffs/s1-t20-write-bench.ts
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { db, pool as pgPool } from "../../server/storage/db";
import { sql } from "drizzle-orm";

const N_HOURS = (() => {
  const n = Number(process.env.BENCH_N ?? "");
  return Number.isInteger(n) && n > 0 ? n : 100_000;
})();
const EMPLOYERS = 50;
const PP_PER_WORKER = 18; // 9 months × 2 biweekly periods
const BASE = 96_000_000;
const PP_BASE = BASE; // staged payperiod nids
const WORKER_BASE = BASE + 5_000_000;
const EMPLOYER_BASE = BASE + 6_000_000;
const BENCH_LOADER = "t20-write-bench";
const MARK_W = "__t356-bench-w-";
const MARK_E = "__t356-bench-e-";

const PROD_STAGED = 3_600_000; // rehearsal T20 staged-row volume
const RATE_GATE = 450; // groups/s — 10× the observed 45/s
const PROJECTION_GATE_S = 9000; // ≈ 2.5 h for the full projected T20 phase

const q = async <T>(query: ReturnType<typeof sql>): Promise<T[]> =>
  ((await db.execute(query)) as unknown as { rows: T[] }).rows;

let failures = 0;
function check(name: string, ok: boolean, detail?: string): void {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

interface LoaderEnvelope {
  summary: { created: number; updated: number; deleted: number; unchanged: number };
  verify: { status: string };
  detail: Record<string, any>;
}

let runSeq = 0;
function runLoader(): { code: number; seconds: number; result: LoaderEnvelope | null; tail: string } {
  const resultPath = `/tmp/t356-bench-${process.pid}-${++runSeq}.json`;
  const t0 = Date.now();
  const res = spawnSync("npx", ["tsx", "scripts/s1-migration/load-hours.ts", "--migration-mode"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      S1_RESULT_JSON_PATH: resultPath,
      NODE_OPTIONS: "--max-old-space-size=512", // completing under the cap proves bounded memory
      S1_PROGRESS_INTERVAL_MS: "20000",
    },
    maxBuffer: 64 * 1024 * 1024,
    timeout: 30 * 60 * 1000,
  });
  const seconds = Math.round((Date.now() - t0) / 100) / 10;
  let result: LoaderEnvelope | null = null;
  if (existsSync(resultPath)) {
    try {
      result = JSON.parse(readFileSync(resultPath, "utf8")) as LoaderEnvelope;
    } catch { /* leave null */ }
    try { unlinkSync(resultPath); } catch { /* ignore */ }
  }
  const out = `${res.stdout ?? ""}\n${res.stderr ?? ""}`;
  console.log(`  · load-hours.ts --migration-mode → exit ${res.status} (${seconds}s)`);
  return { code: res.status ?? -1, seconds, result, tail: out.slice(-2500) };
}

const BENCH_WORKER_IDS = sql`SELECT s2_id FROM s1_staging.id_map WHERE entity = 'worker' AND loader = ${BENCH_LOADER}`;

async function cleanup(): Promise<void> {
  // Marker/tag-based predicates only — rerunnable after any crash. Order:
  // dependents first; id_map LAST (the subqueries above need it).
  await db.execute(sql`DELETE FROM worker_hours WHERE worker_id IN (${BENCH_WORKER_IDS})`);
  await db.execute(sql`DELETE FROM s1_staging.hours_keys WHERE worker_id IN (${BENCH_WORKER_IDS})`);
  // denorm rows cascade-delete worker_employment_denorm rows the app's cron
  // may have computed for bench workers while the bench ran.
  await db.execute(sql`DELETE FROM denorm WHERE entity_id IN (${BENCH_WORKER_IDS})`);
  await db.execute(sql`DELETE FROM workers WHERE id IN (${BENCH_WORKER_IDS})`);
  await db.execute(sql`DELETE FROM contacts WHERE display_name LIKE ${MARK_W + "%"}`);
  await db.execute(sql`
    DELETE FROM employers WHERE name LIKE ${MARK_E + "%"}
      AND id IN (SELECT s2_id FROM s1_staging.id_map WHERE entity = 'employer' AND loader = ${BENCH_LOADER})
  `);
  await db.execute(sql`
    DELETE FROM s1_staging.records
     WHERE bundle = 'sirius_payperiod' AND nid >= ${PP_BASE} AND nid < ${WORKER_BASE}
  `);
  await db.execute(sql`DELETE FROM s1_staging.id_map WHERE loader = ${BENCH_LOADER}`);
}

async function ledgerSnapshot(): Promise<{ n: number; total: string }> {
  const r = (await q<{ n: number; total: string }>(sql`
    SELECT count(*)::int AS n, COALESCE(sum(amount), 0)::text AS total FROM ledger
  `))[0];
  return { n: Number(r.n), total: String(r.total) };
}

async function main() {
  if (process.argv.includes("--cleanup-only")) {
    await cleanup();
    console.log("cleanup complete");
    await pgPool.end();
    return;
  }

  await cleanup(); // stale rows from an aborted run

  // ---- baseline: dev's own staged corpus, converged (also proves the dev
  // DB is in a runnable state before we attribute anything to the bench) ----
  console.log(`== baseline run (dev corpus only) ==`);
  const base = runLoader();
  check("baseline: exit 0", base.code === 0, base.tail);
  check("baseline: verify pass", base.result?.verify.status === "pass", JSON.stringify(base.result?.verify));
  if (base.code !== 0 || !base.result) throw new Error("baseline run failed — dev DB not in a runnable state");
  const devWritten = Number(base.result.detail.written);

  const ledgerBefore = await ledgerSnapshot();

  // ---- seed: workers, employers, id_map, staged payperiods ----
  console.log(`== seeding ${N_HOURS} staged payperiods (~${Math.ceil(N_HOURS / PP_PER_WORKER)} workers × 9 months × 2 periods, ${EMPLOYERS} employers) ==`);
  const seed0 = Date.now();
  const workerCount = Math.ceil(N_HOURS / PP_PER_WORKER);
  await db.execute(sql`
    INSERT INTO contacts (display_name)
    SELECT ${MARK_W} || g FROM generate_series(0, ${workerCount - 1}) g
  `);
  await db.execute(sql`
    INSERT INTO workers (contact_id)
    SELECT c.id FROM contacts c WHERE c.display_name LIKE ${MARK_W + "%"}
  `);
  await db.execute(sql`
    INSERT INTO s1_staging.id_map (entity, s1_id, s2_id, stub, loader)
    SELECT 'worker', ${WORKER_BASE} + split_part(c.display_name, '-w-', 2)::bigint, w.id, false, ${BENCH_LOADER}
      FROM workers w JOIN contacts c ON c.id = w.contact_id
     WHERE c.display_name LIKE ${MARK_W + "%"}
    ON CONFLICT (entity, s1_id) DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO employers (name)
    SELECT ${MARK_E} || g FROM generate_series(0, ${EMPLOYERS - 1}) g
  `);
  await db.execute(sql`
    INSERT INTO s1_staging.id_map (entity, s1_id, s2_id, stub, loader)
    SELECT 'employer', ${EMPLOYER_BASE} + split_part(e.name, '-e-', 2)::bigint, e.id, false, ${BENCH_LOADER}
      FROM employers e WHERE e.name LIKE ${MARK_E + "%"}
    ON CONFLICT (entity, s1_id) DO NOTHING
  `);
  // Biweekly payperiods, 80 h each, hour-type tid 1544 (Active) — the same
  // staged shape the rehearsal target carries (field_sirius_json totals).
  await db.execute(sql`
    INSERT INTO s1_staging.records (bundle, nid, title, changed, fields)
    SELECT 'sirius_payperiod', ${PP_BASE} + g, NULL, 1700000000,
           jsonb_build_object(
             'field_sirius_worker', (${WORKER_BASE} + g / ${PP_PER_WORKER})::int,
             'field_grievance_shop', (${EMPLOYER_BASE} + (g / ${PP_PER_WORKER}) % ${EMPLOYERS})::int,
             'field_sirius_date_start',
               format('2025-%s-%s 00:00:00',
                      lpad((1 + (g % ${PP_PER_WORKER}) / 2)::text, 2, '0'),
                      CASE WHEN g % 2 = 0 THEN '01' ELSE '15' END),
             'field_sirius_json', jsonb_build_object('value', jsonb_build_object(
               'totals', jsonb_build_object('hours', jsonb_build_object(
                 'total', 80, 'by_type', jsonb_build_object('1544', 80))))))
      FROM generate_series(0, ${N_HOURS - 1}) g
  `);
  const expectedGroups = Number((await q<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM (
      SELECT DISTINCT fields->>'field_sirius_worker', fields->>'field_grievance_shop',
                      left(fields->>'field_sirius_date_start', 7)
        FROM s1_staging.records
       WHERE bundle = 'sirius_payperiod' AND nid >= ${PP_BASE} AND nid < ${WORKER_BASE}
    ) t
  `))[0].n);
  console.log(`seeded in ${Math.round((Date.now() - seed0) / 1000)}s — expectedGroups=${expectedGroups} devBaselineWritten=${devWritten}`);

  const measurements: Record<string, unknown> = { N_HOURS, expectedGroups, devWritten };
  try {
    const evaluateRun = (label: "run1" | "run2", r: ReturnType<typeof runLoader>): void => {
      check(`${label}: exit 0`, r.code === 0, r.tail);
      check(`${label}: envelope present`, r.result != null);
      if (!r.result) return;
      const d = r.result.detail;
      check(`${label}: bulk write path used`, d.bulkWritePath === true);
      check(`${label}: verify pass`, r.result.verify.status === "pass", JSON.stringify(r.result.verify));
      check(`${label}: zero verify mismatches`, Number(d.verifyMismatchCount) === 0, `n=${d.verifyMismatchCount}`);
      check(`${label}: written == verified`, Number(d.written) === Number(d.verified), `written=${d.written} verified=${d.verified}`);
      check(`${label}: exact group parity (dev + bench)`, Number(d.written) === devWritten + expectedGroups, `written=${d.written} want=${devWritten + expectedGroups}`);
      check(`${label}: no unresolved refs`, Number(d.unresolvedWorker) === 0 && Number(d.unresolvedEmployer) === 0, `w=${d.unresolvedWorker} e=${d.unresolvedEmployer}`);
      check(
        `${label}: createdRows ${label === "run1" ? "== bench groups (insert-heavy)" : "== 0 (pure conflict updates)"}`,
        Number(d.createdRows) === (label === "run1" ? expectedGroups : 0),
        `createdRows=${d.createdRows}`,
      );
      const ps = d.phaseStats ?? {};
      const writeRate = Number(ps.writeGroupsPerSec ?? 0);
      const scanRate = Number(ps.scanRowsPerSec ?? 0);
      const verifyRate = Number(ps.verifyKeysPerSec ?? 0);
      check(`${label}: write ≥ ${RATE_GATE} groups/s (10× the 45/s per-row path)`, writeRate >= RATE_GATE, `writeGroupsPerSec=${writeRate}`);
      // Projection: production 3.6M staged rows at the measured bench ratio
      // and this run's own phase-local rates (scan + write + verify).
      const projGroups = Math.round((PROD_STAGED * expectedGroups) / N_HOURS);
      const projected =
        (scanRate > 0 ? PROD_STAGED / scanRate : Infinity) +
        (writeRate > 0 ? projGroups / writeRate : Infinity) +
        (verifyRate > 0 ? projGroups / verifyRate : Infinity);
      check(
        `${label}: projected full T20 ≤ ${PROJECTION_GATE_S}s (~2.5h)`,
        projected <= PROJECTION_GATE_S,
        `projected=${Math.round(projected)}s (scan=${scanRate}/s write=${writeRate}/s verify=${verifyRate}/s groups=${projGroups})`,
      );
      measurements[label] = {
        seconds: r.seconds,
        written: Number(d.written),
        createdRows: Number(d.createdRows),
        phaseStats: ps,
        downstream: d.downstream,
        projectedSeconds: Math.round(projected),
        projGroups,
      };
    };

    console.log("== run1: insert-heavy ==");
    evaluateRun("run1", runLoader());

    console.log("== run2: rerun (conflict-update path) ==");
    evaluateRun("run2", runLoader());

    // ---- exact S2 parity, sidecar coverage, charge silence ----
    const agg = (await q<{ rows: number; total: string; bad_day: number }>(sql`
      SELECT count(*)::int AS rows, COALESCE(sum(hours), 0)::text AS total,
             count(*) FILTER (WHERE day <> 1)::int AS bad_day
        FROM worker_hours WHERE worker_id IN (${BENCH_WORKER_IDS})
    `))[0];
    check("parity: one row per bench month-group", Number(agg.rows) === expectedGroups, `rows=${agg.rows} want=${expectedGroups}`);
    check("parity: SUM(hours) == 80 × staged rows", Number(agg.total) === 80 * N_HOURS, `sum=${agg.total} want=${80 * N_HOURS}`);
    check("parity: all rows day=1", Number(agg.bad_day) === 0, `badDay=${agg.bad_day}`);
    const keys = (await q<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM s1_staging.hours_keys WHERE worker_id IN (${BENCH_WORKER_IDS})
    `))[0];
    check("parity: sidecar stamped exactly once per bench group", Number(keys.n) === expectedGroups, `keys=${keys.n}`);
    const ledgerAfter = await ledgerSnapshot();
    check(
      "charges: zero ledger delta across both wet runs",
      ledgerAfter.n === ledgerBefore.n && ledgerAfter.total === ledgerBefore.total,
      `before=${JSON.stringify(ledgerBefore)} after=${JSON.stringify(ledgerAfter)}`,
    );
    measurements.ledger = { before: ledgerBefore, after: ledgerAfter };
  } finally {
    await cleanup();
    console.log("cleanup: bench rows removed");
  }

  console.log(JSON.stringify({ heapCapMB: 512, gates: { RATE_GATE, PROJECTION_GATE_S, PROD_STAGED }, measurements, failures }, null, 2));
  await pgPool.end();
  process.exit(failures > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : err);
  try {
    await cleanup();
  } catch (cleanupErr) {
    console.error("cleanup after failure also failed:", cleanupErr);
  }
  try { await pgPool.end(); } catch { /* ignore */ }
  process.exit(1);
});
