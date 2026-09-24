import { storage } from "../../../../storage";
import { eventBus } from "../../../../services/event-bus";
import { registerCronPlugin } from "../registry";
import { ticksDue } from "../tick";
import type { CronJobContext, CronJobResult } from "../types";

/**
 * Emits the wall-clock heartbeats other plugins subscribe to.
 *
 * This job holds no domain knowledge whatsoever: it works out which periods
 * have just turned over and emits one event each. What to DO on a tick belongs
 * entirely to the subscriber — see `../tick.ts` for the contract a subscriber
 * is entitled to rely on (best-effort, level-triggered) and, just as
 * importantly, the one it is not.
 *
 * Disabling this job silences every subscriber at once, which is the honest
 * form of a dependency that used to be invisible: a bespoke scan cron could be
 * turned off while the notifiers it fed went on looking perfectly healthy.
 */

const JOB_ID = "cron-tick-emitter";

registerCronPlugin({
  metadata: {
    id: JOB_ID,
    name: "Cron Tick Emitter",
    description:
      "Emits the periodic tick events (ten minute, hourly, two hour, four hour, eight hour, daily) that other plugins subscribe to instead of running a cron job of their own. Other features depend on this job: disabling it stops all of them.",
    singleton: true,
  },
  // The emitter's own cadence is the finest period it can emit. A coarser
  // schedule delays every tick; a finer one only adds runs that emit nothing,
  // since dueness is decided from the wall clock rather than from the schedule.
  defaultSchedule: "*/10 * * * *",
  defaultEnabled: true,

  async execute(context: CronJobContext): Promise<CronJobResult> {
    const now = new Date();
    // The previous LIVE SUCCESS, not simply the previous run: the row for this
    // run already exists and is still `running`, a test run must not consume a
    // real tick, and a run that failed did not emit what it was owed.
    const previous = await storage.cronJobRuns.getLastSuccessfulLiveRun(JOB_ID);
    const lastRunAt = previous?.startedAt ?? null;
    const due = ticksDue(now, lastRunAt);
    const periods = due.map((tick) => tick.spec.period);

    if (context.mode === "test") {
      return {
        message: due.length
          ? `Test mode: would emit ${due.length} tick(s): ${periods.join(", ")}`
          : "Test mode: no tick is due",
        metadata: {
          wouldEmit: periods,
          since: lastRunAt?.toISOString() ?? null,
        },
      };
    }

    const emitted: string[] = [];
    const failures: { period: string; handler: string; message: string }[] = [];

    for (const tick of due) {
      // Per-subscriber failure isolation: one bad handler must cost neither the
      // rest of this tick's subscribers nor the remaining periods, but it must
      // not vanish either, so the failures land in the run summary.
      const handlerFailures = await eventBus.emitWithFailures(tick.spec.event, {
        period: tick.spec.period,
        slotStartedAt: tick.slotStartedAt.toISOString(),
      });
      emitted.push(tick.spec.period);
      for (const failure of handlerFailures) {
        failures.push({
          period: tick.spec.period,
          handler: failure.handlerName,
          message: failure.message,
        });
      }
    }

    const summary = emitted.length
      ? `Emitted ${emitted.length} tick(s): ${emitted.join(", ")}`
      : "No tick due";

    return {
      message: failures.length
        ? `${summary}; ${failures.length} subscriber(s) failed`
        : summary,
      metadata: {
        emitted,
        since: lastRunAt?.toISOString() ?? null,
        ...(failures.length ? { failures } : {}),
      },
    };
  },
});
