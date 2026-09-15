import { recomputeStaleDenorm } from "../../denorm";
import { registerCronPlugin } from "../registry";
import type { CronJobContext, CronJobResult } from "../types";

/**
 * `denorm_stale` cron — hourly fallback for the denorm queue drain.
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
      "Hourly fallback that recomputes stale denorm rows and marks them ok across all denorm plugins.",
    singleton: true,
  },
  // Existing installations already persist this schedule. Prompt bounded
  // draining comes from the shared ten-minute tick subscriber, rather than
  // silently changing every installed cron configuration at registration.
  defaultSchedule: "30 * * * *",
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
