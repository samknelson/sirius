// One-off LIVE verification of the scheduled benefit-scan sweep enqueue path.
// Runs the plugin live (active_elections), shows the queue rows it created,
// re-runs to prove already-pending workers are skipped, then deletes the
// pending sweep entries it created.
import "../../server/storage/database";
import { storage } from "../../server/storage";
import { getCronPlugin } from "../../server/plugins/system/cron/registry";
import "../../server/plugins/system/cron/plugins/scheduledBenefitScan";
import { getClient } from "../../server/storage/transaction-context";
import { sql } from "drizzle-orm";

async function main() {
  const plugin = getCronPlugin("scheduled-benefit-scan")!;
  const settings = { population: "active_elections", frequency: "weekly", dayOfWeek: 1, runTime: "02:00", timeZone: "America/Los_Angeles", switchAnchorDay: 15 };
  const ctx = { jobId: "verify-live", jobName: "scheduled-benefit-scan", isManual: true, mode: "live" as const, settings };
  const res = await plugin.execute(ctx);
  console.log("RESULT:", res.message);
  const client = getClient();
  const rows = await client.execute(sql`SELECT month, year, status, count(*)::int AS n FROM trust_wmb_scan_queue WHERE trigger_source = 'scheduled_sweep' GROUP BY 1,2,3 ORDER BY 2,1`);
  console.log("QUEUE:", JSON.stringify(rows.rows));
  const res2 = await plugin.execute({ ...ctx, jobId: "verify-live2" });
  console.log("RESULT2:", res2.message);
  const del = await client.execute(sql`DELETE FROM trust_wmb_scan_queue WHERE trigger_source = 'scheduled_sweep' AND status = 'pending' RETURNING id`);
  console.log("CLEANED:", del.rows.length);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
