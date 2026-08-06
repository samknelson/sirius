/**
 * DEV-ONLY guard wrapper for the seeding smoke suites:
 *   - scripts/oneoffs/s1-t16-t19-smoke.ts   (loader end-to-end)
 *   - scripts/oneoffs/s1-parity-smoke.ts    (parity-harness gates)
 *
 * The smoke suites SEED AND DELETE fake staged rows, id_map entries and S2
 * rows in the target database. They must NEVER run against production. A
 * hostname check is not reliable (dev branches are Neon-hosted too), so this
 * wrapper fingerprints the SYNTHETIC dev dataset before allowing the run:
 *
 *   - s1_staging.records must be small (< 10,000 rows; production is ~9.15M)
 *   - exactly 30 staged sirius_payment rows, ALL type-less (the synthetic
 *     signature the smoke's own asserts hardcode — e.g. "typeless real rows
 *     rejected === 30")
 *   - fewer than 10,000 workers (production is ~117k)
 *
 * Any mismatch → exit 1 with no writes. On a fingerprint match the wrapper
 * execs the smoke as a real CLI and propagates its exit code.
 *
 * Registered as the `s1-smoke-dev-only` validation; the fingerprint also
 * means the check fails fast (instead of seeding garbage) if someone points
 * EXTERNAL_DATABASE_URL anywhere unexpected.
 */
import { spawnSync } from "child_process";
import { db, pool as pgPool } from "../../server/storage/db";
import { sql } from "drizzle-orm";
import { resolveDatabaseUrl, describeDatabaseTarget } from "../../shared/database-url";

async function count(q: ReturnType<typeof sql>): Promise<number> {
  const res = (await db.execute(q)) as unknown as { rows: Array<{ n: string | number }> };
  return Number(res.rows[0]?.n ?? NaN);
}

async function main() {
  console.log(`[s1-smoke guard] target: ${describeDatabaseTarget(resolveDatabaseUrl())}`);

  const problems: string[] = [];

  const staged = await count(sql`SELECT count(*) AS n FROM s1_staging.records`).catch(() => NaN);
  if (!(staged < 10_000)) {
    problems.push(`s1_staging.records has ${staged} rows (expected < 10,000 synthetic rows; production is ~9.15M or staging schema is unreadable)`);
  }

  const payments = await count(sql`SELECT count(*) AS n FROM s1_staging.records WHERE bundle = 'sirius_payment'`).catch(() => NaN);
  const typedPayments = await count(
    sql`SELECT count(*) AS n FROM s1_staging.records WHERE bundle = 'sirius_payment' AND fields ? 'field_sirius_payment_type'`,
  ).catch(() => NaN);
  if (payments !== 30 || typedPayments !== 0) {
    problems.push(`staged sirius_payment fingerprint mismatch: ${payments} rows, ${typedPayments} typed (synthetic dev DB has exactly 30, all type-less)`);
  }

  const workers = await count(sql`SELECT count(*) AS n FROM workers`).catch(() => NaN);
  if (!(workers < 10_000)) {
    problems.push(`workers has ${workers} rows (expected < 10,000; production is ~117k)`);
  }

  await pgPool.end();

  if (problems.length > 0) {
    console.error("[s1-smoke guard] REFUSING TO RUN — target does not look like the synthetic dev database:");
    for (const p of problems) console.error(`  - ${p}`);
    console.error("[s1-smoke guard] This suite seeds/deletes fake rows and is DEV-ONLY. Nothing was written.");
    process.exit(1);
  }

  console.log("[s1-smoke guard] synthetic-dev fingerprint OK — running smoke suites");
  for (const script of ["scripts/oneoffs/s1-t16-t19-smoke.ts", "scripts/oneoffs/s1-parity-smoke.ts"]) {
    console.log(`[s1-smoke guard] running ${script}`);
    const res = spawnSync("npx", ["tsx", script], { stdio: "inherit", timeout: 30 * 60_000 });
    if ((res.status ?? 1) !== 0) process.exit(res.status ?? 1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("[s1-smoke guard] error before any smoke write:", err);
  process.exit(1);
});
