import { registerDispatchEligPlugin } from "../registry";
import type { DispatchEligPlugin, EligibilityCondition, EligibilityQueryContext } from "../registry";
import { isValidYmd, parseYmdParts, toYmd } from "@shared/utils/date";

/**
 * Sentinel fact naming — DELIBERATELY UNPRODUCED.
 *
 * This plugin is a whole-job yes/no, not a per-worker rule, so it has no
 * denormalized facts of its own and no denorm plugin behind it. To say "nobody
 * is eligible" inside the existing framework it asks for a fact that NOTHING
 * ever writes: an `exists` condition over this category/value is false for
 * every worker, in both the eligible-worker list query and the per-worker
 * acceptance check.
 *
 * If you are here because you went looking for the producer of these facts:
 * there is none, and there should never be one. Writing this category would
 * quietly disable the plugin.
 */
const NEVER_SATISFIED_CATEGORY = "dispatch_started_never";
const NEVER_SATISFIED_VALUE = "job-start-time-passed";

/** How a job with a start date but no start time is treated. */
type MissingStartTimeBehavior = "start_of_day" | "end_of_day";

interface StartedPluginConfig {
  gracePeriodMinutes?: number;
  missingStartTime?: MissingStartTimeBehavior;
}

/**
 * Has this job's start moment, shifted by the grace period, passed as of
 * `now`? Pure: `now` is supplied, never read from the clock.
 *
 * The moment is built from numeric date and time components with the
 * server-local `Date` constructor, which — since the timezone work — is the
 * system time zone the naive `start_ymd` / `start_time` columns are written and
 * read in. No zone is chosen, passed or converted here; reading those columns
 * as UTC would be the bug.
 *
 * `startYmd` may arrive as a `YYYY-MM-DD` string, an ISO-ish timestamp string
 * or a `Date` (the way the single-shift plugin defends against); `startTime` is
 * a wall-clock string (`HH:MM` / `HH:MM:SS`) or null.
 *
 * Exported only so the decision math can be unit tested; nothing outside this
 * plugin and its test uses it.
 */
export function hasJobStartMomentPassed(params: {
  startYmd: string | Date | null | undefined;
  startTime: string | null | undefined;
  gracePeriodMinutes: number;
  missingStartTime: MissingStartTimeBehavior;
  now: Date;
}): boolean {
  const { startYmd, startTime, gracePeriodMinutes, missingStartTime, now } = params;

  const ymd = toYmd(startYmd ?? null);
  // No usable start date: there is no moment to have passed, so the plugin
  // stays out of the way.
  if (!ymd || !isValidYmd(ymd)) return false;
  const { year, month, day } = parseYmdParts(ymd);

  const time = parseWallClockTime(startTime);
  const startMoment =
    time !== null
      ? new Date(year, month - 1, day, time.hours, time.minutes, time.seconds, 0)
      : missingStartTime === "start_of_day"
        ? new Date(year, month - 1, day, 0, 0, 0, 0)
        : new Date(year, month - 1, day, 23, 59, 59, 999);

  const grace = Number.isFinite(gracePeriodMinutes) ? gracePeriodMinutes : 0;
  return now.getTime() >= startMoment.getTime() + grace * 60_000;
}

/** Split a wall-clock `HH:MM[:SS]` column value into numeric parts. */
function parseWallClockTime(
  value: string | null | undefined,
): { hours: number; minutes: number; seconds: number } | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = match[3] === undefined ? 0 : Number(match[3]);
  if (hours > 23 || minutes > 59 || seconds > 59) return null;
  return { hours, minutes, seconds };
}

function readConfig(config: Record<string, unknown>): {
  gracePeriodMinutes: number;
  missingStartTime: MissingStartTimeBehavior;
} {
  const raw = (config ?? {}) as StartedPluginConfig;
  const grace =
    typeof raw.gracePeriodMinutes === "number" && Number.isFinite(raw.gracePeriodMinutes)
      ? raw.gracePeriodMinutes
      : 0;
  const missingStartTime: MissingStartTimeBehavior =
    raw.missingStartTime === "start_of_day" ? "start_of_day" : "end_of_day";
  return { gracePeriodMinutes: grace, missingStartTime };
}

/**
 * `dispatch_started` — READ side. Makes EVERY worker ineligible for a job once
 * its start moment plus the configured grace period has passed, and changes
 * nothing before that.
 *
 * Unlike the other eligibility plugins this one reads no worker facts: the
 * answer is the same for everybody, so it either contributes no condition at
 * all (job still open) or the never-satisfied sentinel condition above (job
 * started).
 */
export const dispatchStartedPlugin: DispatchEligPlugin = {
  id: "dispatch_started",
  name: "Job Already Started",
  description:
    "Makes all workers ineligible once the job's start time (plus a grace period) has passed",
  requiredComponent: "dispatch",

  configSchema: {
    type: "object",
    properties: {
      gracePeriodMinutes: {
        type: "number",
        title: "Grace Period (minutes)",
        description:
          "Minutes to shift the cut-off by, relative to the job's start time. 0 blocks dispatching exactly at the start time; 30 keeps the job open for 30 minutes after it starts; -15 closes it 15 minutes early. Negative values are allowed.",
        // No `minimum` on purpose — a negative grace period (close the job
        // before it starts) is a supported setting.
        default: 0,
      },
      missingStartTime: {
        type: "string",
        title: "Jobs Without a Start Time",
        description:
          "The start time is optional, so this decides what a job with only a start date means. End of day: the job counts as starting at 23:59:59 on its start date, so it stays open all day. Start of day: it counts as starting at 00:00, so it is closed for the whole of its start date.",
        enum: ["end_of_day", "start_of_day"],
        enumNames: [
          "End of day (23:59:59) — open all of its start date",
          "Start of day (00:00) — closed for all of its start date",
        ],
        default: "end_of_day",
      },
    },
  },

  getEligibilityCondition(
    context: EligibilityQueryContext,
    config: Record<string, unknown>,
  ): EligibilityCondition | null {
    const { gracePeriodMinutes, missingStartTime } = readConfig(config);
    const job = context.job;

    const passed = hasJobStartMomentPassed({
      startYmd: job.startYmd,
      startTime: job.startTime,
      gracePeriodMinutes,
      missingStartTime,
      now: new Date(),
    });

    // Still open: contribute nothing, so the plugin is invisible to the query.
    if (!passed) return null;

    // Started: a condition no worker can ever satisfy (see the sentinel note
    // at the top of this file).
    return {
      category: NEVER_SATISFIED_CATEGORY,
      type: "exists",
      value: NEVER_SATISFIED_VALUE,
      failureMessage: `The job's start time (with a grace period of ${gracePeriodMinutes} minutes) has passed`,
    };
  },
};

registerDispatchEligPlugin(dispatchStartedPlugin);
