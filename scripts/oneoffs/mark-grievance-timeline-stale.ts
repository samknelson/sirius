/**
 * One-off: mark every grievance_timeline denorm row as stale so the
 * denorm_stale recompute job re-derives due dates under the new
 * business-calendar-aware rule (Task: grievance business days via calendar).
 *
 * Idempotent — re-running just re-marks the rows stale again.
 *
 * Run: npx tsx scripts/oneoffs/mark-grievance-timeline-stale.ts
 */
import { storage } from "../../server/storage";

async function main() {
  const configs = await storage.pluginConfigs.getByKindAndPlugin("denorm", "grievance_timeline");
  if (configs.length === 0) {
    console.log("No grievance_timeline denorm config found — nothing to mark.");
    return;
  }
  for (const config of configs) {
    const updated = await storage.denorm.markAllStaleForConfig(config.id);
    console.log(`Config ${config.id}: marked ${updated} denorm row(s) stale.`);
  }
  console.log("Done. The denorm_stale cron will recompute the rows.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
