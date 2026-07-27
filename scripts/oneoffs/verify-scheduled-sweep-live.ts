// One-off verification: run the scheduled-benefit-scan plugin in TEST mode
// against the real dev DB (no enqueues) and print the coverage summary.
import "../../server/storage";
import { getCronPlugin } from "../../server/plugins/system/cron/registry";
import "../../server/plugins/system/cron/plugins/scheduledBenefitScan";

async function main() {
  const plugin = getCronPlugin("scheduled-benefit-scan")!;
  for (const population of ["active_elections", "previous_month_benefit", "all_workers"]) {
    const res = await plugin.execute({
      jobId: "verify", jobName: "scheduled-benefit-scan", isManual: true, mode: "test",
      settings: { population, frequency: "weekly", dayOfWeek: 1, runTime: "02:00", timeZone: "America/Los_Angeles", switchAnchorDay: 15 },
    });
    console.log(population, "->", res.message);
  }
  // deriveSchedule sanity
  console.log("derived:", plugin.deriveSchedule!({ frequency: "monthly", dayOfMonth: 3, runTime: "04:30", timeZone: "America/Los_Angeles" }));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
