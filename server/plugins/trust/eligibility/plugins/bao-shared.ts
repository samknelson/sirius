import { storage } from "../../../../storage/database";

/**
 * Shared helpers for the site-specific BAO eligibility plugins
 * (`sitespecific-bao-buildup` and `sitespecific-bao-threshold`).
 *
 * Both plugins resolve a worker's hours threshold the same way — employer →
 * industry → the worker's member status in that industry as of a date → the
 * threshold stored on that member status's JSON — so that logic lives here once
 * and cannot drift between the two plugins.
 */

/** Read a non-negative integer threshold from a member status option's JSON. */
export function readThresholdFromMs(ms: unknown): number | undefined {
  const value = (ms as { data?: { sitespecific?: { bao?: { threshold?: unknown } } } } | null)
    ?.data?.sitespecific?.bao?.threshold;
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : undefined;
}

/** Last day of the given month, as a YYYY-MM-DD string. */
export function lastDayOfMonthYmd(year: number, month: number): string {
  const d = new Date(year, month, 0);
  const yr = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const dy = String(d.getDate()).padStart(2, "0");
  return `${yr}-${mo}-${dy}`;
}

export function monthName(month: number): string {
  return new Date(2000, month - 1, 1).toLocaleString("default", { month: "long" });
}

/** year/month → a single comparable ordinal (months since year 0). */
export function toOrdinal(year: number, month: number): number {
  return year * 12 + (month - 1);
}

export function fromOrdinal(ord: number): { year: number; month: number } {
  return { year: Math.floor(ord / 12), month: (ord % 12) + 1 };
}

/**
 * Resolve the hours threshold for a worker by walking employer → industry →
 * the worker's member status in that industry as of the date → the threshold
 * stored on that member status's JSON. Falls back to `defaultThreshold` when
 * any link is missing. `resolved` is false whenever the default was used.
 */
export async function resolveBaoThreshold(
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
 * Fallback threshold resolution used when no employer could be resolved from
 * the worker's trust election (or an explicit employer). Rather than failing
 * outright, derive candidate employers from the worker's own hours:
 *
 *  - keep every employer whose *most recent* hours record carries an
 *    employment status flagged `employed` (the general "actively employed"
 *    flag — the worker still looks like they work there), and
 *  - that has at least one hours record dated at or before the benefit (last
 *    qualifying) month, and
 *  - resolve each such employer's threshold via `resolveBaoThreshold` and
 *    return the LOWEST one (the most generous requirement for the worker).
 *
 * Returns `undefined` when the worker has no qualifying employer, so callers
 * can preserve the original "no employer could be resolved" failure.
 */
export async function resolveLowestActiveEmployerThreshold(
  workerId: string,
  asOfYmd: string,
  benefit: { year: number; month: number },
  defaultThreshold: number,
): Promise<
  { threshold: number; resolved: boolean; employerId: string } | undefined
> {
  const benefitOrdinal = toOrdinal(benefit.year, benefit.month);

  // Latest hours row per employer, carrying the joined employment status.
  const current = await storage.workerHours.getWorkerHoursCurrent(workerId);
  const activeEmployerIds = new Set<string>();
  for (const row of current) {
    if (row.employerId && row.employmentStatus?.employed === true) {
      activeEmployerIds.add(row.employerId);
    }
  }
  if (activeEmployerIds.size === 0) return undefined;

  // Of those, keep only employers with hours at or before the benefit month.
  const monthlyRows = await storage.workerHours.getWorkerHoursMonthly(workerId);
  const employersWithHoursInWindow = new Set<string>();
  for (const row of monthlyRows) {
    if (!row.employerId || !activeEmployerIds.has(row.employerId)) continue;
    const year = Number(row.year);
    const month = Number(row.month);
    if (!Number.isFinite(year) || !Number.isFinite(month)) continue;
    if (toOrdinal(year, month) <= benefitOrdinal) {
      employersWithHoursInWindow.add(row.employerId);
    }
  }
  if (employersWithHoursInWindow.size === 0) return undefined;

  // Resolve each candidate's threshold and keep the lowest.
  let best:
    | { threshold: number; resolved: boolean; employerId: string }
    | undefined;
  for (const employerId of employersWithHoursInWindow) {
    const { threshold, resolved } = await resolveBaoThreshold(
      workerId,
      employerId,
      asOfYmd,
      defaultThreshold,
    );
    if (best === undefined || threshold < best.threshold) {
      best = { threshold, resolved, employerId };
    }
  }
  return best;
}
