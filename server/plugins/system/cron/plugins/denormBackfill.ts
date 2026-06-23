import { backfillAllDenorm } from "../../denorm";
import { registerCronPlugin } from "../registry";
import type { CronJobContext, CronJobResult } from "../types";

/**
 * `denorm_backfill` cron — hourly sweep that enqueues missing denorm rows and
 * deletes orphaned ones.
 *
 * Calls the denorm wrapper's `backfillAllDenorm`, which finds entities that
 * should have a denorm row but don't and inserts them as `stale`, and finds
 * denorm rows whose entity no longer exists ("widows") and deletes them. The
 * (separate, later) `denorm_stale` recompute job drains the stale queue. In
 * `test` mode the run is a dry run: it reports how many rows it would enqueue
 * and delete without writing.
 */
registerCronPlugin({
  metadata: {
    id: "denorm_backfill",
    name: "Denorm Backfill",
    description:
      "Hourly sweep that enqueues missing denorm rows as stale and deletes orphaned denorm rows across all denorm plugins.",
    singleton: true,
  },
  defaultSchedule: "0 * * * *", // Hourly, on the hour
  defaultEnabled: true,

  async execute(context: CronJobContext): Promise<CronJobResult> {
    const summary = await backfillAllDenorm({ mode: context.mode });
    const enqueueVerb = context.mode === "live" ? "Enqueued" : "Would enqueue";
    const deleteVerb = context.mode === "live" ? "deleted" : "would delete";
    return {
      message: `${enqueueVerb} ${summary.totalEnqueued} stale denorm rows and ${deleteVerb} ${summary.totalDeleted} widow rows across ${summary.perPlugin.length} plugins`,
      metadata: {
        totalEnqueued: summary.totalEnqueued,
        totalDeleted: summary.totalDeleted,
        perPlugin: summary.perPlugin,
      },
    };
  },
});
