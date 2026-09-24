import { runDataRetention } from "../../data-retention";
import { registerCronPlugin } from "../registry";
import type { CronJobContext, CronJobResult } from "../types";

/**
 * `data-retention` cron — the single sweep that runs every enabled
 * data-retention plugin (see `server/plugins/system/data-retention/`).
 *
 * Replaces the five scattered cleanup cron jobs (delete-expired-hfe,
 * delete-expired-reports, delete-expired-flood-events, dispatch-eba-cleanup,
 * delete-old-cron-logs). In `test` mode each plugin reports what it would
 * delete without deleting anything; `live` mode deletes and reports per-plugin
 * counts. A single failing plugin is isolated and does not abort the sweep.
 */
registerCronPlugin({
  metadata: {
    id: "data-retention",
    name: "Data Retention Sweep",
    description:
      "Runs all enabled data-retention plugins, deleting each domain's expired rows (per-plugin counts in the run log).",
    singleton: true,
  },
  defaultSchedule: "0 3 * * *", // Daily at 3 AM
  defaultEnabled: true,

  async execute(context: CronJobContext): Promise<CronJobResult> {
    const summary = await runDataRetention({ mode: context.mode });
    const verb = context.mode === "test" ? "Would delete" : "Deleted";
    return {
      message: `${verb} ${summary.totalDeleted} rows across ${summary.perPlugin.length} data-retention plugins (${summary.totalErrored} plugin(s) errored)`,
      metadata: {
        totalDeleted: summary.totalDeleted,
        totalErrored: summary.totalErrored,
        perPlugin: summary.perPlugin,
      },
    };
  },
});
