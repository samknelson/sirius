/**
 * Verify the T631 interview Offers view plumbing:
 *  - excludePluginIds skips the interview eligibility plugin
 *  - a worker blocked ONLY by the interview plugin appears when excluded
 *  - the offers join marks workers with existing interviews
 */
// Register all eligibility plugins (the storage module only imports the
// registry; plugin files are pulled in by the plugin index at boot).
import "../../server/plugins/dispatch/eligibility";
import { db } from "../../server/storage/db";
import { sql } from "drizzle-orm";
import { createDispatchEligibleWorkersStorage } from "../../server/storage/dispatch/eligible-workers";

const JOB_ID = "6c898879-25e3-4248-b955-97a5d523b885";

let failures = 0;
function check(name: string, ok: boolean, extra?: unknown) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : " " + JSON.stringify(extra)}`);
  if (!ok) failures++;
}

async function main() {
  const storage = createDispatchEligibleWorkersStorage();

  const full = await storage.getEligibleWorkersForJob(JOB_ID, 500, 0);
  const excluded = await storage.getEligibleWorkersForJob(JOB_ID, 500, 0, {
    excludePluginIds: ["sitespecific_t631_interview"],
  });

  check(
    "interview condition applied in full run",
    full.appliedConditions.some((c) => c.pluginId === "sitespecific_t631_interview"),
    full.appliedConditions.map((c) => c.pluginId),
  );
  check(
    "interview condition skipped when excluded",
    !excluded.appliedConditions.some((c) => c.pluginId === "sitespecific_t631_interview"),
    excluded.appliedConditions.map((c) => c.pluginId),
  );
  check(
    "excluded set is a superset of full set",
    full.workers.every((w) => excluded.workers.some((e) => e.id === w.id)) &&
      excluded.total >= full.total,
    { full: full.total, excluded: excluded.total },
  );

  // Offers join: interview rows for the job map onto excluded-eligible workers
  const rows = (await db.execute(
    sql`SELECT worker_id, status FROM sitespecific_t631_job_interviews WHERE job_id = ${JOB_ID}`,
  )).rows as Array<{ worker_id: string; status: string }>;
  const byWorker = new Map(rows.map((r) => [r.worker_id, r.status]));
  const offered = excluded.workers.filter((w) => byWorker.has(w.id));
  console.log(
    `INFO job has ${rows.length} interview rows; ${offered.length} of them among ${excluded.total} interview-excluded eligible workers`,
  );
  check("join logic resolves statuses", offered.every((w) => !!byWorker.get(w.id)));

  if (failures) {
    console.log("FAILURES:", failures);
    process.exit(1);
  }
  console.log("ALL PASS");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
