/**
 * Runs at 09:00 America/Los_Angeles. Alerts unless today's scheduled daily
 * aggregate report exists and passed. Reads aggregate migration metadata only.
 */
import { pool } from "../../server/storage/db";
import { publishS1AutomationAlert } from "./lib/sns-alert";

async function main(): Promise<void> {
  const result = await pool.query<{
    started_at: Date;
    result: string | null;
    duration_sec: string | null;
    findings: unknown;
  }>(`
    SELECT started_at,
           report->>'result' AS result,
           report->>'durationSec' AS duration_sec,
           report->'findingsByKind' AS findings
      FROM s1_staging.runs
     WHERE args->>'command' = 'sync'
       AND args->>'mode' = 'daily'
       AND args->>'profile' = 'production'
       AND COALESCE((args->>'forceReconcile')::boolean, false) = false
       AND COALESCE((args->>'skipStage')::boolean, false) = false
       AND COALESCE((args->>'keepGoing')::boolean, false) = false
       AND report->>'result' = 'PASS'
       AND started_at >= (
         (now() AT TIME ZONE 'America/Los_Angeles')::date
         AT TIME ZONE 'America/Los_Angeles'
       )
     ORDER BY started_at DESC
     LIMIT 1
  `);
  const row = result.rows[0];
  if (row) {
    console.log(JSON.stringify({
      event: "s1-daily-sync-deadline-check",
      status: "pass",
      startedAt: row.started_at.toISOString(),
      durationSec: row.duration_sec == null ? null : Number(row.duration_sec),
      findingsByKind: row.findings ?? {},
    }));
    return;
  }
  const message = JSON.stringify({
    event: "s1-daily-sync-late",
    status: row ? "no-success" : "missing",
    date: new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Los_Angeles",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date()),
  });
  console.error(message);
  await publishS1AutomationAlert("S1 daily sync has no successful completion by 9 AM Pacific", message);
  process.exitCode = 1;
}

main()
  .finally(() => pool.end())
  .catch((error) => {
    console.error(`[scheduled-daily-late-check] FATAL ${(error as Error).name}`);
    process.exit(1);
  });
