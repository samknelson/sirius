/**
 * Pure date math for the scheduled benefit-scan sweep cron.
 *
 * Coverage-month pair rule: each run scans TWO coverage months, decided at
 * execution time in the configured time zone. Let `switch_date(M)` be the
 * first scan day in the run month `M` whose day-of-month is strictly greater
 * than `switchAnchorDay`. A run before that date scans `[M-1, M]`; a run on
 * or after it scans `[M, M+1]`. Because scan days within a month are strictly
 * increasing, this reduces per-run to: day-of-month > anchor → `[M, M+1]`,
 * otherwise `[M-1, M]`. Coverage is never more than one month ahead of the
 * run month, and nothing is stored or precomputed.
 */

export interface CoverageMonthRef {
  month: number; // 1-12
  year: number;
}

/** Add `n` months to a month reference (n may be negative). */
export function addCoverageMonths(ref: CoverageMonthRef, n: number): CoverageMonthRef {
  const total = ref.year * 12 + (ref.month - 1) + n;
  return { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 + 1 };
}

/**
 * The calendar date (year/month/day) of `instant` as observed in `timeZone`.
 * Throws on an invalid IANA time-zone name.
 */
export function getZonedDateParts(
  instant: Date,
  timeZone: string,
): { year: number; month: number; day: number } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const year = get("year");
  const month = get("month");
  const day = get("day");
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    throw new Error(`Could not resolve date parts for time zone "${timeZone}"`);
  }
  return { year, month, day };
}

/** True when `timeZone` is a valid IANA zone Intl can resolve. */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Compute the ordered pair of coverage months for a run at `instant`,
 * evaluated in `timeZone` against `switchAnchorDay` (see module doc).
 */
export function computeCoverageMonthPair(
  instant: Date,
  timeZone: string,
  switchAnchorDay: number,
): [CoverageMonthRef, CoverageMonthRef] {
  if (!Number.isInteger(switchAnchorDay) || switchAnchorDay < 1 || switchAnchorDay > 28) {
    throw new Error(`switchAnchorDay must be an integer between 1 and 28 (got ${switchAnchorDay})`);
  }
  const { year, month, day } = getZonedDateParts(instant, timeZone);
  const runMonth: CoverageMonthRef = { month, year };
  return day > switchAnchorDay
    ? [runMonth, addCoverageMonths(runMonth, 1)]
    : [addCoverageMonths(runMonth, -1), runMonth];
}

export type SweepFrequency = "weekly" | "monthly";

export interface SweepScheduleFields {
  frequency: SweepFrequency;
  /** 0 (Sunday) – 6 (Saturday); required when frequency is weekly. */
  dayOfWeek?: number;
  /** 1–28; required when frequency is monthly. */
  dayOfMonth?: number;
  /** "HH:MM" 24-hour local time in `timeZone`. */
  runTime: string;
  timeZone: string;
}

const RUN_TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * Translate the friendly schedule fields into a standard 5-field cron
 * expression plus the IANA time zone the scheduler must evaluate it in
 * (node-cron's `timezone` option), so runs fire at the configured LOCAL time
 * regardless of the server clock's zone. Throws on invalid fields.
 */
export function deriveSweepCronSchedule(fields: SweepScheduleFields): {
  schedule: string;
  timezone: string;
} {
  const m = RUN_TIME_RE.exec(fields.runTime);
  if (!m) {
    throw new Error(`runTime must be "HH:MM" 24-hour time (got "${fields.runTime}")`);
  }
  if (!isValidTimeZone(fields.timeZone)) {
    throw new Error(`Invalid time zone "${fields.timeZone}"`);
  }
  const hour = Number(m[1]);
  const minute = Number(m[2]);

  if (fields.frequency === "weekly") {
    const dow = fields.dayOfWeek;
    if (!Number.isInteger(dow) || dow! < 0 || dow! > 6) {
      throw new Error("day_of_week (0=Sunday … 6=Saturday) is required for a weekly schedule");
    }
    return { schedule: `${minute} ${hour} * * ${dow}`, timezone: fields.timeZone };
  }
  const dom = fields.dayOfMonth;
  if (!Number.isInteger(dom) || dom! < 1 || dom! > 28) {
    throw new Error("day_of_month (1–28) is required for a monthly schedule");
  }
  return { schedule: `${minute} ${hour} ${dom} * *`, timezone: fields.timeZone };
}
