/**
 * Idempotent repair for already-loaded T18 (s1-import) ledger entries that
 * were written with migration-only reference types instead of the runtime
 * vocabulary the app's consumers match on:
 *
 *   ledger_payment → payment   (payment history, transaction views,
 *                               statement/invoice classification)
 *   trust_wmb      → wmb       (charge-plugin reference type for
 *                               worker-month-benefit rows)
 *
 * Scope is strictly charge_plugin='s1-import' rows; 's1-unknown' references
 * and data provenance (data.s1ReferenceNid etc.) are left untouched. The
 * loader itself now writes runtime types directly (see
 * scripts/s1-migration/load-ledger.ts REFERENCE_ENTITIES), so a future
 * production T18 run needs no repair.
 *
 * Idempotent: reruns find zero rows with the old names and update nothing.
 * Updates run in batches to avoid one long-lived lock over ~547K rows.
 *
 * Usage: npx tsx scripts/oneoffs/repair-s1-import-reference-types.ts [--dry-run]
 * Output: aggregate JSON counts only (no row data).
 */
import { db, pool as pgPool } from "../../server/storage/db";
import { sql } from "drizzle-orm";

const CHARGE_PLUGIN = "s1-import";
const DRY_RUN = process.argv.includes("--dry-run");
const BATCH = 50000;

const RENAMES: Array<{ from: string; to: string }> = [
  { from: "ledger_payment", to: "payment" },
  { from: "trust_wmb", to: "wmb" },
];

async function countByType(referenceType: string): Promise<number> {
  const res = (await db.execute(sql`
    SELECT count(*)::int AS n FROM ledger
     WHERE charge_plugin = ${CHARGE_PLUGIN} AND reference_type = ${referenceType}
  `)) as unknown as { rows: Array<{ n: number }> };
  return res.rows[0]?.n ?? 0;
}

async function main() {
  const report: Record<string, unknown> = {
    script: "repair-s1-import-reference-types",
    dryRun: DRY_RUN,
  };
  const renames: Array<Record<string, unknown>> = [];
  let totalUpdated = 0;

  for (const { from, to } of RENAMES) {
    const beforeFrom = await countByType(from);
    const beforeTo = await countByType(to);

    let updated = 0;
    if (!DRY_RUN && beforeFrom > 0) {
      // Batched UPDATE keyed by id subquery; loops until no rows remain.
      for (;;) {
        const res = (await db.execute(sql`
          WITH batch AS (
            SELECT id FROM ledger
             WHERE charge_plugin = ${CHARGE_PLUGIN} AND reference_type = ${from}
             LIMIT ${BATCH}
          )
          UPDATE ledger SET reference_type = ${to}
           WHERE id IN (SELECT id FROM batch)
          RETURNING 1 AS one
        `)) as unknown as { rows: Array<{ one: number }> };
        const n = res.rows.length;
        updated += n;
        if (n < BATCH) break;
      }
    }

    const afterFrom = DRY_RUN ? beforeFrom : await countByType(from);
    const afterTo = DRY_RUN ? beforeTo : await countByType(to);
    totalUpdated += updated;
    renames.push({
      from,
      to,
      beforeFromCount: beforeFrom,
      beforeToCount: beforeTo,
      updated: DRY_RUN ? `would update ${beforeFrom}` : updated,
      afterFromCount: afterFrom,
      afterToCount: afterTo,
      consistent: DRY_RUN || (afterFrom === 0 && afterTo === beforeTo + updated),
    });
  }

  report.renames = renames;
  report.totalUpdated = totalUpdated;
  console.log(JSON.stringify(report, null, 2));

  const inconsistent = renames.some((r) => r.consistent === false);
  await pgPool.end();
  process.exit(inconsistent ? 1 : 0);
}

main().catch((err) => {
  // Never echo raw driver errors (they can embed row values).
  if (process.env.S1_MIGRATION_DEBUG === "1") console.error(err);
  else if (err instanceof Error) console.error(`FATAL ${err.constructor.name}: ${String(err.message).split("\n")[0]}`);
  else console.error("FATAL: unknown_error");
  process.exit(1);
});
