import { recomputeStaleDenorm } from "../../denorm";
import { registerCronPlugin } from "../registry";
import type { CronJobContext, CronJobResult } from "../types";

/**
 * `denorm_stale` cron — hourly job that drains the stale denorm queue.
 *
 * Calls the denorm wrapper's `recomputeStaleDenorm`, which pulls a capped batch
 * of each plugin's `stale` rows, recomputes their payload, and marks them `ok`.
 * This is the counterpart to `denorm_backfill` (which enqueues missing rows as
 * `stale`) and the admin "clear" tool (which floods a config with stale work):
 * those produce stale rows, this drains them. A single bad entity is marked
 * `error` and the batch continues. In `test` mode the run is a dry run: it
 * reports how many rows it would recompute without writing.
 */
registerCronPlugin({
  metadata: {
    id: "denorm_stale",
    name: "Denorm Stale Recompute",
    description:
      "Hourly job that recomputes stale denorm rows and marks them ok across all denorm plugins.",
    singleton: true,
  },
  defaultSchedule: "0 * * * *", // Hourly, on the hour
  defaultEnabled: true,

  async execute(context: CronJobContext): Promise<CronJobResult> {
    const summary = await recomputeStaleDenorm({ mode: context.mode });
    const verb = context.mode === "live" ? "Recomputed" : "Would recompute";
    return {
      message: `${verb} ${summary.totalRecomputed} stale denorm rows (${summary.totalErrored} errored) across ${summary.perPlugin.length} plugins`,
      metadata: {
        totalRecomputed: summary.totalRecomputed,
        totalErrored: summary.totalErrored,
        perPlugin: summary.perPlugin,
      },
    };
  },
});
