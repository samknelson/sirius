/**
 * Separate operator-only inventory/rebind. Never part of the fleet.
 * Dry: --checkpoint <common-source-staging-checkpoint>
 * Wet: same args + --wet --approve <dry-run evidenceHash>
 * Output is aggregate-only. No staging, restaging, allocation, or rebilling.
 */
import { pool } from "../../server/storage/db";
import { drainStorageSideEffects } from "../../server/storage/drain-storage-side-effects";
import { acquireMigrationSeedLock } from "./lib/migration-lock";
import { repairFinancialLinks, FinancialRepairRefusal } from "./lib/financial-link-repair";
import { assertMigrationTimeZone } from "./lib/timezone-contract";

function flag(name: string) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : "";
}

async function main() {
  const wet = process.argv.includes("--wet");
  const checkpoint = flag("--checkpoint");
  const approval = flag("--approve");
  const stream = flag("--stream");
  if (stream && stream !== "ar" && stream !== "payment") throw new FinancialRepairRefusal("--stream must be ar or payment");
  if (!checkpoint) throw new FinancialRepairRefusal("--checkpoint is required; compare an exact common source/staging snapshot, not live counts");
  if (wet && !/^[a-f0-9]{64}$/.test(approval)) throw new FinancialRepairRefusal("--wet requires --approve <reviewed dry-run evidenceHash>");
  // Deliberately do not honor parent lock markers: this command must be run
  // separately from a fleet. A parent-held lock must refuse, not bypass.
  let lock: Awaited<ReturnType<typeof acquireMigrationSeedLock>> = null;
  try {
    lock = await acquireMigrationSeedLock(pool, { standalone: true });
    // A dry inventory stays strictly read-only. A wet run also proves the
    // migration runtime's timezone contract before any storage mutation.
    if (wet) await assertMigrationTimeZone();
    const report = await repairFinancialLinks({
      wet, checkpoint, approval, stream: stream === "ar" || stream === "payment" ? stream : undefined,
    });
    // Ledger storage enqueues old/new coordinates on the transaction's
    // after-commit queue. Drain them before closing the standalone process.
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await drainStorageSideEffects();
    if (lock) { await lock.query("SELECT pg_advisory_unlock(727001)"); lock.release(); }
    await pool.end();
  }
}
main().catch((error) => {
  // Never relay raw driver errors, hashes with data, or row contents.
  console.error(error instanceof FinancialRepairRefusal ? error.message :
    "Financial-link command refused or failed; no partial repair was committed. Check staging schema and migration lock; run a fresh dry inventory.");
  process.exitCode = 1;
});
