import { EligibilityPlugin } from "../base";
import {
  EligibilityContext,
  EligibilityResult,
  EligibilityPluginMetadata,
  BaseEligibilityConfig,
} from "../types";
import { registerEligibilityPlugin } from "../registry";
import { storage } from "../../../../storage/database";

/**
 * Defaults that mirror the legacy PHP implementation:
 * - 100 hours when no threshold is configured on the member status,
 * - a "buildup" completes at 3 consecutive at-or-above-threshold months,
 * - a "break" completes at 12 consecutive below-threshold months,
 * - a worker sitting in a 10+ month low-hours stretch is flagged with a
 *   non-blocking warning.
 */
const DEFAULT_THRESHOLD = 100;
const DEFAULT_BUILDUP_MONTHS = 3;
const DEFAULT_BREAK_MONTHS = 12;
const DEFAULT_WARNING_BREAK_COUNT = 10;

interface BaoBuildupConfig extends BaseEligibilityConfig {
  defaultThreshold?: number;
  buildupMonths?: number;
  breakMonths?: number;
  warningBreakCount?: number;
}

/**
 * Rich result of a buildup determination. The eligibility plugin maps this
 * onto `EligibilityResult`, but the helper is intentionally exported so other
 * parts of the app can read the underlying numbers without constructing a
 * full eligibility context.
 */
export interface BuildupStatus {
  /** True when buildup is complete (the worker is eligible). */
  success: boolean;
  /** Human-readable explanation of the outcome. */
  reason: string;
  /** Threshold actually used for the walk. */
  threshold: number;
  /** False when no member-status threshold was found and the default was used. */
  thresholdResolved: boolean;
  /** The supplied as-of month/year. */
  asofMonth: number;
  asofYear: number;
  /** The benefit month/year the walk counted back from. */
  threemonthsprevMonth: number;
  threemonthsprevYear: number;
  /** Whether the benefit month itself had any hours / met the threshold. */
  threemonthsprevNonzero: boolean;
  threemonthsprevElig: boolean;
  /** Running consecutive counters at the point the walk stopped. */
  buildupCount: number;
  breakCount: number;
  /** Trailing ("current", i.e. most recent) buildup run length. */
  currentBuildupCount: number;
  currentBuildupOver: boolean;
  /** Trailing ("current") break run length and where it started. */
  currentBreakCount: number;
  currentBreakOver: boolean;
  currentBreakFirstYear: number;
  currentBreakFirstMonth: number;
  currentBreakFirstHrs: number;
  /** True when the current break is long enough to warrant a warning. */
  warning: boolean;
  /** False when the worker has no hours history at or before the benefit month. */
  hasHours: boolean;
  /** Each walked month (descending), with its summed hours. */
  monthDetails: Array<{ year: number; month: number; hours: number }>;
}

export interface FetchBuildupOptions {
  /**
   * When true, the benefit month is the as-of month itself (an election /
   * enrollment). When false/omitted (an ongoing scan), the benefit month is
   * three months earlier.
   */
  isElection?: boolean;
  /** Explicit threshold override; when set, the employer→industry→status chain is skipped. */
  threshold?: number;
  /** Employer whose industry drives threshold resolution when no explicit threshold is given. */
  employerId?: string;
  /** Fallback threshold when neither an explicit threshold nor a status threshold is found. */
  defaultThreshold?: number;
  buildupMonths?: number;
  breakMonths?: number;
  warningBreakCount?: number;
}

/** Read a non-negative integer threshold from a member status option's JSON. */
function readThresholdFromMs(ms: unknown): number | undefined {
  const value = (ms as { data?: { sitespecific?: { bao?: { threshold?: unknown } } } } | null)
    ?.data?.sitespecific?.bao?.threshold;
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : undefined;
}

/** Last day of the given month, as a YYYY-MM-DD string. */
function lastDayOfMonthYmd(year: number, month: number): string {
  const d = new Date(year, month, 0);
  const yr = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const dy = String(d.getDate()).padStart(2, "0");
  return `${yr}-${mo}-${dy}`;
}

function monthName(month: number): string {
  return new Date(2000, month - 1, 1).toLocaleString("default", { month: "long" });
}

/** year/month → a single comparable ordinal (months since year 0). */
function toOrdinal(year: number, month: number): number {
  return year * 12 + (month - 1);
}

function fromOrdinal(ord: number): { year: number; month: number } {
  return { year: Math.floor(ord / 12), month: (ord % 12) + 1 };
}

/**
 * Resolve the hours threshold for a worker by walking employer → industry →
 * the worker's member status in that industry as of the date → the threshold
 * stored on that member status's JSON. Falls back to {@link DEFAULT_THRESHOLD}
 * (or a caller-supplied default) when any link is missing.
 */
async function resolveThreshold(
  workerId: string,
  employerId: string | undefined,
  asOfYmd: string,
  defaultThreshold: number,
): Promise<{ threshold: number; resolved: boolean }> {
  if (!employerId) return { threshold: defaultThreshold, resolved: false };

  const employer = await storage.employers.getEmployer(employerId);
  const industryId = employer?.industryId;
  if (!industryId) return { threshold: defaultThreshold, resolved: false };

  // History is ordered by date descending, so the first row matching the
  // industry and dated on or before the as-of date is the status in effect.
  const history = await storage.workerMsh.getWorkerMsh(workerId);
  const asOf = history.find(
    (row) =>
      row.industryId === industryId &&
      typeof row.date === "string" &&
      row.date <= asOfYmd,
  );
  if (!asOf) return { threshold: defaultThreshold, resolved: false };

  const threshold = readThresholdFromMs(asOf.ms);
  if (threshold === undefined) return { threshold: defaultThreshold, resolved: false };

  return { threshold, resolved: true };
}

/**
 * Compute a worker's buildup status as of a month. Loads the worker's full
 * monthly hours once, resolves the threshold (unless one is supplied), and
 * walks months backward from the benefit month tracking buildup/break runs.
 */
export async function fetchBuildupStatus(
  workerId: string,
  asOf: { year: number; month: number },
  options: FetchBuildupOptions = {},
): Promise<BuildupStatus> {
  const defaultThreshold = options.defaultThreshold ?? DEFAULT_THRESHOLD;
  const buildupMonths = options.buildupMonths ?? DEFAULT_BUILDUP_MONTHS;
  const breakMonths = options.breakMonths ?? DEFAULT_BREAK_MONTHS;
  const warningBreakCount = options.warningBreakCount ?? DEFAULT_WARNING_BREAK_COUNT;

  const asofYear = asOf.year;
  const asofMonth = asOf.month;

  // Benefit month: three months prior for ongoing scans, the as-of month
  // itself for elections.
  const benefitOrdinal =
    toOrdinal(asofYear, asofMonth) - (options.isElection ? 0 : 3);
  const { year: threemonthsprevYear, month: threemonthsprevMonth } =
    fromOrdinal(benefitOrdinal);

  const asOfYmd = lastDayOfMonthYmd(asofYear, asofMonth);
  const { threshold, resolved } = await resolveThreshold(
    workerId,
    options.threshold === undefined ? options.employerId : undefined,
    asOfYmd,
    defaultThreshold,
  );
  const effectiveThreshold = options.threshold ?? threshold;
  const thresholdResolved = options.threshold !== undefined ? true : resolved;

  // Build a single hours-per-month total across all employers/statuses.
  const monthlyRows = await storage.workerHours.getWorkerHoursMonthly(workerId);
  const hoursByOrdinal = new Map<number, number>();
  let earliestHoursOrdinal: number | undefined;
  for (const row of monthlyRows) {
    const year = Number(row.year);
    const month = Number(row.month);
    if (!Number.isFinite(year) || !Number.isFinite(month)) continue;
    const ord = toOrdinal(year, month);
    const hrs = Number(row.totalHours) || 0;
    hoursByOrdinal.set(ord, (hoursByOrdinal.get(ord) ?? 0) + hrs);
    if (earliestHoursOrdinal === undefined || ord < earliestHoursOrdinal) {
      earliestHoursOrdinal = ord;
    }
  }

  const base: BuildupStatus = {
    success: false,
    reason: "",
    threshold: effectiveThreshold,
    thresholdResolved,
    asofMonth,
    asofYear,
    threemonthsprevMonth,
    threemonthsprevYear,
    threemonthsprevNonzero: false,
    threemonthsprevElig: false,
    buildupCount: 0,
    breakCount: 0,
    currentBuildupCount: 0,
    currentBuildupOver: false,
    currentBreakCount: 0,
    currentBreakOver: false,
    currentBreakFirstYear: 0,
    currentBreakFirstMonth: 0,
    currentBreakFirstHrs: 0,
    warning: false,
    hasHours: false,
    monthDetails: [],
  };

  // No hours at or before the benefit month — nothing to walk.
  if (earliestHoursOrdinal === undefined || earliestHoursOrdinal > benefitOrdinal) {
    return {
      ...base,
      reason: `No hours entries found at or before ${monthName(threemonthsprevMonth)} ${threemonthsprevYear} (threshold ${effectiveThreshold}).`,
    };
  }

  let buildupCount = 0;
  let breakCount = 0;
  let currentBuildupCount = 0;
  let currentBuildupOver = false;
  let currentBreakCount = 0;
  let currentBreakOver = false;
  let currentBreakFirstYear = 0;
  let currentBreakFirstMonth = 0;
  let currentBreakFirstHrs = 0;
  let threemonthsprevNonzero = false;
  let threemonthsprevElig = false;
  const monthDetails: Array<{ year: number; month: number; hours: number }> = [];

  let outcome: { success: boolean; reason: string } | undefined;

  for (let ord = benefitOrdinal; ord >= earliestHoursOrdinal; ord--) {
    const { year: y, month: m } = fromOrdinal(ord);
    const hrs = hoursByOrdinal.get(ord) ?? 0;
    monthDetails.push({ year: y, month: m, hours: hrs });

    const atOrAbove = hrs >= effectiveThreshold;

    // Benefit month flags.
    if (m === threemonthsprevMonth && y === threemonthsprevYear) {
      if (hrs > 0) threemonthsprevNonzero = true;
      if (atOrAbove) threemonthsprevElig = true;
    }

    // Trailing "current" break: counts low-hours months until the first
    // at-or-above month is seen (walking backward from the benefit month).
    if (atOrAbove) {
      currentBreakOver = true;
    } else if (!currentBreakOver) {
      currentBreakCount++;
      currentBreakFirstYear = y;
      currentBreakFirstMonth = m;
      currentBreakFirstHrs = hrs;
    }

    // Trailing "current" buildup: counts at-or-above months until the first
    // low month is seen.
    if (atOrAbove) {
      if (!currentBuildupOver) currentBuildupCount++;
    } else {
      currentBuildupOver = true;
    }

    // Consecutive-run counters that reset on a change.
    buildupCount = atOrAbove ? buildupCount + 1 : 0;
    breakCount = atOrAbove ? 0 : breakCount + 1;

    // Buildup complete.
    if (buildupCount >= buildupMonths) {
      let reason = `Buildup complete (threshold ${effectiveThreshold}): ${buildupMonths} consecutive months at or above threshold, most recently starting ${monthName(m)} ${y}.`;
      reason +=
        currentBreakCount > 0
          ? ` There have since been ${currentBreakCount} month(s) of low hours.`
          : " There are no subsequent low-hours months.";
      outcome = { success: true, reason };
      break;
    }

    // Break complete.
    if (breakCount >= breakMonths) {
      outcome = {
        success: false,
        reason: `Break complete (threshold ${effectiveThreshold}): ${breakMonths} consecutive months below threshold starting ${monthName(m)} ${y} (${Math.round(hrs)} hrs).`,
      };
      break;
    }
  }

  if (!outcome) {
    outcome = {
      success: false,
      reason: `No completed buildup (threshold ${effectiveThreshold}) found at or before ${monthName(threemonthsprevMonth)} ${threemonthsprevYear}.`,
    };
  }

  const warning = warningBreakCount > 0 && currentBreakCount >= warningBreakCount;

  return {
    success: outcome.success,
    reason: outcome.reason,
    threshold: effectiveThreshold,
    thresholdResolved,
    asofMonth,
    asofYear,
    threemonthsprevMonth,
    threemonthsprevYear,
    threemonthsprevNonzero,
    threemonthsprevElig,
    buildupCount,
    breakCount,
    currentBuildupCount,
    currentBuildupOver,
    currentBreakCount,
    currentBreakOver,
    currentBreakFirstYear,
    currentBreakFirstMonth,
    currentBreakFirstHrs,
    warning,
    hasHours: true,
    monthDetails,
  };
}

class BaoBuildupPlugin extends EligibilityPlugin<BaoBuildupConfig> {
  readonly metadata: EligibilityPluginMetadata = {
    id: "sitespecific-bao-buildup",
    name: "BAO - Buildup",
    description:
      "A subscriber is eligible once they have completed buildup: at least the configured number of consecutive months (default 3) with hours at or above the threshold, counting back from the benefit month (the as-of month for elections, otherwise three months earlier). " +
      "The threshold is resolved per worker from the employer's industry and the worker's member status in that industry as of the evaluated date (defaulting to 100 when none is set). " +
      "A subscriber is ineligible if hours stayed below threshold for the configured number of consecutive months (default 12) before any buildup completed. A long current low-hours stretch is reported as a non-blocking warning.",
    requiredComponent: "sitespecific.bao",
    configSchema: {
      type: "object",
      properties: {
        defaultThreshold: {
          type: "integer",
          title: "Default hours threshold",
          description:
            "Used when no threshold is configured on the worker's member status for the employer's industry.",
          minimum: 0,
          default: DEFAULT_THRESHOLD,
        },
        buildupMonths: {
          type: "integer",
          title: "Buildup months",
          description:
            "Consecutive months at or above the threshold required to complete buildup.",
          minimum: 1,
          default: DEFAULT_BUILDUP_MONTHS,
        },
        breakMonths: {
          type: "integer",
          title: "Break months",
          description:
            "Consecutive months below the threshold that complete a break and make the worker ineligible.",
          minimum: 1,
          default: DEFAULT_BREAK_MONTHS,
        },
        warningBreakCount: {
          type: "integer",
          title: "Warning break count",
          description:
            "When the current run of low-hours months reaches this length, a non-blocking warning is added. Set to 0 to disable.",
          minimum: 0,
          default: DEFAULT_WARNING_BREAK_COUNT,
        },
      },
    },
  };

  async evaluate(
    context: EligibilityContext,
    config: BaoBuildupConfig,
  ): Promise<EligibilityResult> {
    if (!context.employer) {
      return {
        eligible: false,
        reason:
          "No employer could be resolved for the subscriber on the evaluated date, so the hours threshold cannot be determined.",
      };
    }

    const status = await fetchBuildupStatus(
      context.subscriberWorker.id,
      { year: context.asOfYear, month: context.asOfMonth },
      {
        isElection: context.scanType === "start",
        employerId: context.employer.id,
        defaultThreshold: config.defaultThreshold ?? DEFAULT_THRESHOLD,
        buildupMonths: config.buildupMonths ?? DEFAULT_BUILDUP_MONTHS,
        breakMonths: config.breakMonths ?? DEFAULT_BREAK_MONTHS,
        warningBreakCount: config.warningBreakCount ?? DEFAULT_WARNING_BREAK_COUNT,
      },
    );

    const result: EligibilityResult = {
      eligible: status.success,
      reason: status.reason,
    };

    if (status.warning) {
      result.warning = `Current low-hours stretch is ${status.currentBreakCount} month(s) (since ${monthName(status.currentBreakFirstMonth)} ${status.currentBreakFirstYear}).`;
    }

    return result;
  }
}

const plugin = new BaoBuildupPlugin();
registerEligibilityPlugin(plugin);

export { BaoBuildupPlugin };
