/**
 * Track C bench — timed dry-runs of the T16–T19 loaders against a
 * production-size synthetic staged dataset (default ~220k elections, 100k
 * benefit spans, 150k payments, 200k AR rows; override via BENCH_N).
 *
 * Each loader runs as a real CLI child process under a HARD Node heap cap
 * (--max-old-space-size=512): completing under the cap proves the keyset
 * paging keeps memory bounded; the wall-clock duration is the timing signal.
 *
 * Seeds rows in the 90,000,000+ nid range and removes them afterwards
 * (staged records, raw AR rows, and the handful of id_map rows it adds).
 * Dry-runs never write S2 rows. Aggregates only — no PII.
 *
 * Usage: npx tsx scripts/oneoffs/s1-trackc-bench.ts
 */
import { spawnSync } from "node:child_process";
import { db, pool as pgPool } from "../../server/storage/db";
import { sql } from "drizzle-orm";

const N = (() => {
  const n = Number(process.env.BENCH_N ?? "");
  return Number.isInteger(n) && n > 0 ? n : 0;
})();
const N_ELECTIONS = N || 220_000;
const N_SPANS = N || 100_000;
const N_PAYMENTS = N || 150_000;
const N_LEDGER = N || 200_000;
const N_HOURS = N || 400_000;

const BASE = 90_000_000;
const WORKER_NID = BASE + 1;
const EMPLOYER_NID = BASE + 2;
const BENEFIT_NID = BASE + 3;
const TYPE_TID = BASE + 4;
const BENCH_LOADER = "trackc-bench";

const q = async <T>(query: ReturnType<typeof sql>): Promise<T[]> =>
  ((await db.execute(query)) as unknown as { rows: T[] }).rows;

function runLoader(script: string, args: string[]): { seconds: number; exit: number; tail: string } {
  const t0 = Date.now();
  const res = spawnSync("npx", ["tsx", `scripts/s1-migration/${script}`, "--dry-run", ...args], {
    encoding: "utf8",
    env: { ...process.env, NODE_OPTIONS: "--max-old-space-size=512" },
    maxBuffer: 64 * 1024 * 1024,
    timeout: 30 * 60 * 1000,
  });
  const seconds = Math.round((Date.now() - t0) / 100) / 10;
  const out = `${res.stdout ?? ""}\n${res.stderr ?? ""}`;
  return { seconds, exit: res.status ?? -1, tail: out.slice(-2000) };
}

async function cleanup() {
  await db.execute(sql`DELETE FROM s1_staging.records WHERE nid >= ${BASE}`);
  await db.execute(sql`DELETE FROM s1_staging.raw_ledger_ar WHERE ledger_id >= ${BASE}`);
  await db.execute(sql`DELETE FROM s1_staging.id_map WHERE loader = ${BENCH_LOADER}`);
}

async function main() {
  await cleanup(); // stale rows from an aborted run

  // Real S2 anchors the dry-run resolve passes need (map presence only).
  const worker = (await q<{ id: string }>(sql`SELECT id FROM workers LIMIT 1`))[0];
  const employer = (await q<{ id: string }>(sql`SELECT id FROM employers LIMIT 1`))[0];
  const benefit = (await q<{ id: string }>(sql`SELECT id FROM trust_benefits LIMIT 1`))[0];
  const option = (
    await q<{ id: string; currency_code: string }>(
      sql`SELECT id, currency_code FROM options_ledger_payment_type LIMIT 1`,
    )
  )[0];
  if (!worker || !employer) throw new Error("bench needs at least one worker + employer in the dev DB");

  // Existing staged ledger account whose id_map row exists (currency parity).
  const acct = (
    await q<{ s1_id: string | number; s2_id: string; currency_code: string | null }>(sql`
      SELECT m.s1_id, m.s2_id, a.currency_code
        FROM s1_staging.id_map m JOIN ledger_accounts a ON a.id = m.s2_id
       WHERE m.entity = 'ledger-account' LIMIT 1
    `)
  )[0];

  const put = (entity: string, s1Id: number, s2Id: string) =>
    db.execute(sql`
      INSERT INTO s1_staging.id_map (entity, s1_id, s2_id, stub, loader)
      VALUES (${entity}, ${s1Id}, ${s2Id}, false, ${BENCH_LOADER})
      ON CONFLICT (entity, s1_id) DO NOTHING
    `);
  await put("worker", WORKER_NID, worker.id);
  await put("employer", EMPLOYER_NID, employer.id);
  if (benefit) await put("benefit", BENEFIT_NID, benefit.id);
  if (option) await put("term", TYPE_TID, option.id);

  console.error(
    `seeding: elections=${N_ELECTIONS} spans=${N_SPANS} payments=${N_PAYMENTS} ar=${N_LEDGER} hours=${N_HOURS}`,
  );
  const seed0 = Date.now();

  // T16 elections — untyped, 1-year closed spans.
  await db.execute(sql`
    INSERT INTO s1_staging.records (bundle, nid, title, changed, fields)
    SELECT 'sirius_trust_worker_election', ${BASE + 1_000_000} + g, NULL, 1500000000,
           jsonb_build_object(
             'field_sirius_worker', ${WORKER_NID}::int,
             'field_grievance_shop', ${EMPLOYER_NID}::int,
             'field_sirius_date_start', '2015-01-01 00:00:00',
             'field_sirius_date_end', '2016-01-01 00:00:00',
             'field_sirius_active', 'Yes')
      FROM generate_series(1, ${N_ELECTIONS}) g
  `);

  // T17 spans — 12-month closed spans, subscriber coverage.
  if (benefit) {
    await db.execute(sql`
      INSERT INTO s1_staging.records (bundle, nid, title, changed, fields)
      SELECT 'sirius_trust_worker_benefit', ${BASE + 2_000_000} + g, NULL, 1500000000,
             jsonb_build_object(
               'field_sirius_trust_benefit', ${BENEFIT_NID}::int,
               'field_sirius_trust_subscriber', ${WORKER_NID}::int,
               'field_grievance_shop', ${EMPLOYER_NID}::int,
               'field_sirius_date_start', '2015-01-01 00:00:00',
               'field_sirius_date_end', '2015-12-15 00:00:00',
               'field_sirius_active', 'Yes')
        FROM generate_series(1, ${N_SPANS}) g
    `);
  }

  // T19 payments — typed, cleared (needs an id_map'd staged account for currency parity).
  const canPayments = !!option && !!acct && acct.currency_code === option.currency_code;
  if (canPayments) {
    await db.execute(sql`
      INSERT INTO s1_staging.records (bundle, nid, title, changed, fields)
      SELECT 'sirius_payment', ${BASE + 3_000_000} + g, NULL, 1500000000,
             jsonb_build_object(
               'field_sirius_payment_status', 'Cleared',
               'field_sirius_dollar_amt', '100.00',
               'field_sirius_datetime_created', '2015-01-02 10:00:00',
               'field_sirius_ledger_account', ${Number(acct.s1_id)}::int,
               'field_sirius_payer', ${WORKER_NID}::int,
               'field_sirius_payment_type', ${TYPE_TID}::int)
        FROM generate_series(1, ${N_PAYMENTS}) g
    `);
  }

  // T18 raw AR — cleared charges.
  const canLedger = !!acct;
  if (canLedger) {
    await db.execute(sql`
      INSERT INTO s1_staging.raw_ledger_ar
        (ledger_id, ledger_amount, ledger_status, ledger_account, ledger_participant, ledger_reference, ledger_ts, ledger_memo, ledger_key, ledger_json)
      SELECT ${BASE} + g, '10.00', 'Cleared', ${Number(acct.s1_id)}, ${WORKER_NID}, NULL, 1420070400, NULL, NULL, NULL
        FROM generate_series(1, ${N_LEDGER}) g
    `);
  }
  // T20 payperiods — ~18 monthly periods per synthetic worker; exercises the
  // worker-ordered flush path at production-like group cardinality.
  const hasStatuses = (
    await q<{ n: number }>(sql`SELECT count(*)::int AS n FROM options_employment_status WHERE lower(name) = 'active'`)
  )[0];
  const canHours = Number(hasStatuses?.n ?? 0) > 0;
  if (canHours) {
    await db.execute(sql`
      INSERT INTO s1_staging.records (bundle, nid, title, changed, fields)
      SELECT 'sirius_payperiod', ${BASE + 4_000_000} + g, NULL, 1500000000,
             jsonb_build_object(
               'field_sirius_worker', ${BASE + 5_000_000}::int + (g / 18),
               'field_grievance_shop', ${EMPLOYER_NID}::int,
               'field_sirius_date_start',
                 format('%s-%s-01 00:00:00', 2014 + (g % 18) / 12, lpad((1 + (g % 18) % 12)::text, 2, '0')),
               'field_sirius_json', jsonb_build_object('value', jsonb_build_object(
                 'totals', jsonb_build_object('hours', jsonb_build_object(
                   'total', 80, 'by_type', jsonb_build_object('1544', 80))))))
        FROM generate_series(1, ${N_HOURS}) g
    `);
  }
  console.error(`seeded in ${Math.round((Date.now() - seed0) / 1000)}s`);

  const results: Record<string, unknown> = {};
  try {
    {
      // pre-existing synthetic dev elections stage no worker ref
      const r = runLoader("load-elections.ts", ["--allow-rejects", "worker_ref_missing"]);
      results.t16 = { seconds: r.seconds, exit: r.exit };
      if (r.exit !== 0) console.error(`T16 FAILED\n${r.tail}`);
    }
    if (benefit) {
      const r = runLoader("load-benefit-history.ts", [
        "--allow-rejects",
        "benefit_unmapped,worker_ref_missing,open_end_through_required,benefit_ref_missing,employer_unresolved,relation_unmapped",
      ]);
      results.t17 = { seconds: r.seconds, exit: r.exit };
      if (r.exit !== 0) console.error(`T17 FAILED\n${r.tail}`);
    } else results.t17 = "skipped: no trust_benefits row";
    if (canPayments) {
      const r = runLoader("load-payments.ts", [
        "--allow-rejects",
        "payment_type_missing,payer_ref_missing,status_missing,account_ref_missing,amount_missing,date_missing",
      ]);
      results.t19 = { seconds: r.seconds, exit: r.exit };
      if (r.exit !== 0) console.error(`T19 FAILED\n${r.tail}`);
    } else results.t19 = "skipped: no id_map'd ledger account with matching payment-type currency";
    if (canLedger) {
      const r = runLoader("load-ledger.ts", ["--allow-rejects", "non_cleared_status"]);
      results.t18 = { seconds: r.seconds, exit: r.exit };
      if (r.exit !== 0) console.error(`T18 FAILED\n${r.tail}`);
    } else results.t18 = "skipped: no id_map'd ledger account";
    if (canHours) {
      const r = runLoader("load-hours.ts", []);
      results.t20 = { seconds: r.seconds, exit: r.exit };
      if (r.exit !== 0) console.error(`T20 FAILED\n${r.tail}`);
    } else results.t20 = "skipped: options_employment_status lacks 'Active'";
  } finally {
    await cleanup();
    console.error("cleanup: bench rows removed");
  }

  console.log(JSON.stringify({ heapCapMB: 512, n: { N_ELECTIONS, N_SPANS, N_PAYMENTS, N_LEDGER, N_HOURS }, results }, null, 2));
  await pgPool.end();
  const failed = Object.values(results).some((v) => typeof v === "object" && (v as { exit: number }).exit !== 0);
  process.exit(failed ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  try {
    await cleanup();
  } catch {}
  process.exit(1);
});
