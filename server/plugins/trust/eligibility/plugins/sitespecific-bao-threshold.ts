import { EligibilityPlugin } from "../base";
import {
  EligibilityContext,
  EligibilityResult,
  EligibilityPluginMetadata,
  BaseEligibilityConfig,
} from "../types";
import { registerEligibilityPlugin } from "../registry";
import { storage } from "../../../../storage/database";
import {
  lastDayOfMonthYmd,
  monthName,
  toOrdinal,
  fromOrdinal,
  resolveBaoThreshold,
} from "./bao-shared";

/**
 * "BAO - Threshold" is the simpler sibling of "BAO - Buildup". A worker is
 * eligible when, in the single month three months before the evaluated month,
 * their hours meet or exceed the threshold. There is no consecutive-month
 * buildup and no break logic — only one month is examined.
 *
 * The threshold is resolved per worker from the employer's industry and the
 * worker's member status in that industry (the same value the Member Status
 * Thresholds page manages), defaulting to 100 when none is configured.
 */
const DEFAULT_THRESHOLD = 100;
const LOOKBACK_MONTHS = 3;

interface BaoThresholdConfig extends BaseEligibilityConfig {
  defaultThreshold?: number;
}

/**
 * Result of a threshold determination. Exported so other parts of the app
 * (and the verification script) can read the underlying numbers without
 * constructing a full eligibility context.
 */
export interface ThresholdStatus {
  /** True when the target month's hours meet or exceed the threshold. */
  success: boolean;
  /** Human-readable explanation naming the month, hours, and threshold. */
  reason: string;
  /** Threshold actually used for the comparison. */
  threshold: number;
  /** False when no member-status threshold was found and the default was used. */
  thresholdResolved: boolean;
  /** The supplied as-of month/year. */
  asofMonth: number;
  asofYear: number;
  /** The single month examined (three months before the as-of month). */
  targetMonth: number;
  targetYear: number;
  /** Total hours found for the target month across all employers/statuses. */
  hours: number;
}

export interface FetchThresholdOptions {
  /** Explicit threshold override; when set, the employer→industry→status chain is skipped. */
  threshold?: number;
  /** Employer whose industry drives threshold resolution when no explicit threshold is given. */
  employerId?: string;
  /** Fallback threshold when neither an explicit threshold nor a status threshold is found. */
  defaultThreshold?: number;
}

/**
 * Compute a worker's threshold status as of a month. Resolves the threshold
 * (unless one is supplied), reads the worker's total hours for the single
 * month three months earlier, and compares the two. The look-back is always
 * three months regardless of scan type.
 */
export async function fetchThresholdStatus(
  workerId: string,
  asOf: { year: number; month: number },
  options: FetchThresholdOptions = {},
): Promise<ThresholdStatus> {
  const defaultThreshold = options.defaultThreshold ?? DEFAULT_THRESHOLD;
  const asofYear = asOf.year;
  const asofMonth = asOf.month;

  // The single month examined is always three months before the as-of month,
  // for both election starts and ongoing continuation scans.
  const targetOrdinal = toOrdinal(asofYear, asofMonth) - LOOKBACK_MONTHS;
  const { year: targetYear, month: targetMonth } = fromOrdinal(targetOrdinal);

  const asOfYmd = lastDayOfMonthYmd(asofYear, asofMonth);
  const { threshold, resolved } = await resolveBaoThreshold(
    workerId,
    options.threshold === undefined ? options.employerId : undefined,
    asOfYmd,
    defaultThreshold,
  );
  const effectiveThreshold = options.threshold ?? threshold;
  const thresholdResolved = options.threshold !== undefined ? true : resolved;

  // Sum the target month's hours across all employers/statuses.
  const monthlyRows = await storage.workerHours.getWorkerHoursMonthly(workerId);
  let hours = 0;
  for (const row of monthlyRows) {
    const year = Number(row.year);
    const month = Number(row.month);
    if (year === targetYear && month === targetMonth) {
      hours += Number(row.totalHours) || 0;
    }
  }

  const success = hours >= effectiveThreshold;
  const thresholdNote = thresholdResolved
    ? ""
    : " (default threshold; none configured on the worker's member status)";
  const reason = success
    ? `Eligible: ${Math.round(hours)} hours in ${monthName(targetMonth)} ${targetYear} meet the threshold of ${effectiveThreshold}${thresholdNote}.`
    : `Ineligible: ${Math.round(hours)} hours in ${monthName(targetMonth)} ${targetYear} are below the threshold of ${effectiveThreshold}${thresholdNote}.`;

  return {
    success,
    reason,
    threshold: effectiveThreshold,
    thresholdResolved,
    asofMonth,
    asofYear,
    targetMonth,
    targetYear,
    hours,
  };
}

class BaoThresholdPlugin extends EligibilityPlugin<BaoThresholdConfig> {
  readonly metadata: EligibilityPluginMetadata = {
    id: "sitespecific-bao-threshold",
    name: "BAO - Threshold",
    description:
      "A subscriber is eligible when their hours in the single month three months before the evaluated month meet or exceed the threshold. " +
      "The threshold is resolved per worker from the employer's industry and the worker's member status in that industry as of the evaluated date (defaulting to 100 when none is set). " +
      "The same three-month look-back is applied for both election starts and ongoing continuation scans. Only that one month is examined — there is no consecutive-month buildup or break logic.",
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
      },
    },
  };

  async evaluate(
    context: EligibilityContext,
    config: BaoThresholdConfig,
  ): Promise<EligibilityResult> {
    if (!context.employer) {
      return {
        eligible: false,
        reason:
          "No employer could be resolved for the subscriber on the evaluated date, so the hours threshold cannot be determined.",
      };
    }

    const status = await fetchThresholdStatus(
      context.subscriberWorker.id,
      { year: context.asOfYear, month: context.asOfMonth },
      {
        employerId: context.employer.id,
        defaultThreshold: config.defaultThreshold ?? DEFAULT_THRESHOLD,
      },
    );

    return {
      eligible: status.success,
      reason: status.reason,
    };
  }
}

const plugin = new BaoThresholdPlugin();
registerEligibilityPlugin(plugin);

export { BaoThresholdPlugin };
