import { backfillAllDenorm } from "../../denorm";
import { registerCronPlugin } from "../registry";
import type { CronJobContext, CronJobResult } from "../types";

/**
 * `denorm_backfill` cron — hourly sweep that enqueues missing denorm rows.
 *
 * Calls the denorm wrapper's `backfillAllDenorm`, which finds entities that
 * should have a denorm row but don't and inserts them as `stale`. The (separate,
 * later) `denorm_stale` recompute job drains that queue. In `test` mode the run
 * is a dry run: it reports how many rows it would enqueue without writing.
 */
registerCronPlugin({
  metadata: {
    id: "denorm_backfill",
    name: "Denorm Backfill",
    description:
      "Hourly sweep that enqueues missing denorm rows as stale across all denorm plugins.",
    singleton: true,
  },
  defaultSchedule: "0 * * * *", // Hourly, on the hour
  defaultEnabled: true,

  async execute(context: CronJobContext): Promise<CronJobResult> {
    const summary = await backfillAllDenorm({ mode: context.mode });
    const verb = context.mode === "live" ? "Enqueued" : "Would enqueue";
    return {
      message: `${verb} ${summary.totalEnqueued} stale denorm rows across ${summary.perPlugin.length} plugins`,
      metadata: {
        totalEnqueued: summary.totalEnqueued,
        perPlugin: summary.perPlugin,
      },
    };
  },
});
