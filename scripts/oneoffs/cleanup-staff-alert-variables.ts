/**
 * One-off: remove the retired staff-alert framework's persisted config.
 *
 * The old standalone staff-alert framework stored its subscriber lists in
 * `variables` rows keyed by the `staff_alert:` prefix (e.g.
 * `staff_alert:trust_wmb_scan`). That framework has been replaced by the
 * event-notifier `trust-wmb-scan` notifier, whose recipients live in
 * `plugin_configs.data`. These leftover variables are now dead data; this
 * script deletes them through the storage layer so the change is audited.
 *
 * Idempotent: re-running it simply deletes nothing once the rows are gone.
 *
 * Usage:
 *   npx tsx scripts/oneoffs/cleanup-staff-alert-variables.ts [--dry-run]
 */
import { storage } from "../../server/storage";

const PREFIX = "staff_alert:";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const existing = await storage.variables.getByNamePrefix(PREFIX);

  if (existing.length === 0) {
    console.log(`No variables found with prefix "${PREFIX}". Nothing to do.`);
    return;
  }

  console.log(
    `Found ${existing.length} variable(s) with prefix "${PREFIX}":`,
  );
  for (const v of existing) {
    console.log(`  - ${v.name}`);
  }

  if (dryRun) {
    console.log("\n--dry-run set; no rows deleted.");
    return;
  }

  const deleted = await storage.variables.deleteByNamePrefix(PREFIX);
  console.log(`\nDeleted ${deleted} variable(s).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("cleanup-staff-alert-variables failed:", err);
    process.exit(1);
  });
