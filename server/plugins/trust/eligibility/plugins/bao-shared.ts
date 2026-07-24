import { storage } from "../../../../storage/database";
import { createUnifiedOptionsStorage } from "../../../../storage/unified-options";
import { distanceInMiles, type Coordinates } from "@shared/utils/geocode";
import { getDrivingDistanceMiles } from "../../../../services/driving-distance";
import type { BaoDistanceMethod } from "@shared/schema/sitespecific/bao/schema";
import type { JsonSchema } from "@shared/json-schema-form";

const unifiedOptionsStorage = createUnifiedOptionsStorage();

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

// ---------------------------------------------------------------------------
// Shared distance measurement (geographic criteria)
// ---------------------------------------------------------------------------

const DRIVING_METHOD = "driving distance";
const STRAIGHT_LINE_METHOD = "straight-line distance";

/** Human-readable label for a persisted cache method. */
export function methodLabel(method: BaoDistanceMethod): string {
  return method === "driving" ? DRIVING_METHOD : STRAIGHT_LINE_METHOD;
}

/**
 * Distance between two coordinates, preferring real driving distance via
 * the Google Routes API and falling back to the straight-line haversine
 * calculation when routing is unavailable (API error, quota, timeout, or
 * no route). The returned `method` names how the distance was derived so
 * callers can surface it in eligibility reason text.
 *
 * Two layers of caching sit in front of the Google Routes lookup:
 *  - L1: the in-memory `cache` map, so the same worker↔site pair is never
 *    looked up twice within one evaluation run.
 *  - L2: the persistent `storage.baoDistanceCache` table, shared across runs
 *    and across BAO plugins. A cached DRIVING row is authoritative and
 *    returned directly. A cached STRAIGHT-LINE row is non-authoritative: we
 *    re-attempt a real driving lookup and, if it now succeeds, upgrade the
 *    stored row. On a miss (or an unsuccessful re-attempt) we persist the
 *    freshly measured value so future runs are served from the DB.
 */
export async function measureDistance(
  origin: Coordinates,
  destination: Coordinates,
  cache: Map<string, { distance: number; method: string }>,
): Promise<{ distance: number; method: string }> {
  const key = `${origin.latitude},${origin.longitude}->${destination.latitude},${destination.longitude}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const coords = {
    originLat: origin.latitude,
    originLng: origin.longitude,
    destLat: destination.latitude,
    destLng: destination.longitude,
  };

  // L2 — persistent cache. A driving row is a durable hit; a straight-line
  // row is re-attempted below in the hope of upgrading it to driving.
  const persisted = await storage.baoDistanceCache.getByCoords(coords);
  if (persisted && persisted.method === "driving") {
    const hit = { distance: Number(persisted.distanceMiles), method: DRIVING_METHOD };
    cache.set(key, hit);
    return hit;
  }

  const driving = await getDrivingDistanceMiles(origin, destination);
  const measured =
    driving.status === "ok"
      ? { distance: driving.miles, method: "driving" as BaoDistanceMethod }
      : { distance: distanceInMiles(origin, destination), method: "straight-line" as BaoDistanceMethod };

  await storage.baoDistanceCache.upsert({
    ...coords,
    distanceMiles: measured.distance,
    method: measured.method,
  });

  const result = { distance: measured.distance, method: methodLabel(measured.method) };
  cache.set(key, result);
  return result;
}

export type CoordsLookup =
  | { status: "ok"; coords: Coordinates }
  | { status: "no-address" }
  | { status: "not-geocoded" };

/**
 * Resolve a contact's primary, active address coordinates. Returns a
 * discriminated result so callers can produce explanatory failure
 * messages rather than throwing when an address is missing or has not
 * been geocoded.
 */
export async function getPrimaryCoords(contactId: string): Promise<CoordsLookup> {
  const addresses = await storage.contacts.addresses.getContactPostalByContact(contactId);
  const primary = addresses.find((a) => a.isPrimary && a.isActive);
  if (!primary) return { status: "no-address" };
  if (primary.latitude == null || primary.longitude == null) {
    return { status: "not-geocoded" };
  }
  return {
    status: "ok",
    coords: { latitude: primary.latitude, longitude: primary.longitude },
  };
}

// ---------------------------------------------------------------------------
// Shared continuous-coverage criterion (Start Healthnet / Start Delta /
// Start Kaiser)
// ---------------------------------------------------------------------------

/**
 * The continuous-coverage criterion is configured, evaluated, and rendered
 * identically across all three BAO "Start" election plugins: the worker is
 * eligible when they have held ANY benefit of the chosen benefit type for
 * the required number of consecutive months at some point on or before the
 * evaluated date. Everything about the criterion lives here so the three
 * plugins cannot drift.
 */
export interface ContinuousCoverageCriterion {
  benefitTypeId?: string;
  months?: number;
}

/**
 * JSON-schema fragment for the criterion. `criterionNumber` slots it into
 * each plugin's numbered criterion list; `defaultMonths` keeps each
 * plugin's historical default (Healthnet 6, Delta/Kaiser 24).
 */
export function continuousCoverageSchema(
  criterionNumber: number,
  defaultMonths: number,
): JsonSchema {
  return {
    type: "object",
    title: `Criterion ${criterionNumber} — Continuous coverage`,
    description:
      "Eligible if the worker has held any benefit of the chosen type for the required number of consecutive months at some point on or before the evaluated date. Set both fields to enable; leave unset to skip.",
    properties: {
      benefitTypeId: {
        type: "string",
        title: "Benefit type",
        description: "Pick the benefit type that counts toward continuous coverage.",
        "x-options-resource": "trust-benefit-type",
      },
      months: {
        type: "integer",
        title: "Required consecutive months",
        description: "How many unbroken months of coverage are required.",
        minimum: 1,
        default: defaultMonths,
      },
    },
  } as JsonSchema;
}

/** The criterion is enforced only when BOTH fields are set and sane. */
export function isContinuousCoverageConfigured(
  c: ContinuousCoverageCriterion | undefined,
): c is { benefitTypeId: string; months: number } {
  return (
    typeof c?.benefitTypeId === "string" &&
    c.benefitTypeId.length > 0 &&
    typeof c.months === "number" &&
    Number.isInteger(c.months) &&
    c.months >= 1
  );
}

/**
 * Validate the chosen benefit type exists. Returns an error string, or
 * undefined when valid.
 */
export async function validateContinuousCoverage(
  c: { benefitTypeId: string; months: number },
): Promise<string | undefined> {
  const benefitType = await unifiedOptionsStorage.get("trust-benefit-type", c.benefitTypeId);
  if (!benefitType) {
    return `Continuous coverage criterion: unknown benefit type (${c.benefitTypeId})`;
  }
  return undefined;
}

/**
 * Longest run of consecutive calendar months across the given rows.
 * Each (year, month) is mapped to an ordinal, de-duplicated, sorted, and
 * scanned for the longest streak. Returns 0 when there are no rows.
 */
export function longestConsecutiveMonths(
  rows: Array<{ month: number; year: number }>,
): number {
  const ordinals = Array.from(new Set(rows.map((r) => toOrdinal(r.year, r.month)))).sort(
    (a, b) => a - b,
  );
  if (ordinals.length === 0) return 0;
  let longest = 1;
  let run = 1;
  for (let i = 1; i < ordinals.length; i++) {
    if (ordinals[i] === ordinals[i - 1] + 1) {
      run += 1;
      if (run > longest) longest = run;
    } else {
      run = 1;
    }
  }
  return longest;
}

/**
 * Shape of the subset of `storage.trust.wmb.getWorkerBenefits` rows the
 * criterion depends on. Other columns exist on the row but are not consumed.
 */
interface ContinuousCoverageHistoryRow {
  month: number;
  year: number;
  benefit?: { benefitType?: string | null } | null;
}

/**
 * Evaluate the criterion: met when the worker has held any benefit whose
 * type is in `benefitTypeIds` for at least `months` consecutive months at
 * some point on or before the evaluated (as-of) month. Coverage dated
 * after the as-of month never counts. `benefitTypeIds` is a set to support
 * the Delta plugin's legacy benefit-list configs, which may map to more
 * than one type; new configs always pass exactly one.
 */
export async function evaluateContinuousCoverage(options: {
  workerId: string;
  benefitTypeIds: string[];
  months: number;
  asOfYear: number;
  asOfMonth: number;
}): Promise<{ met: boolean; reason: string }> {
  const { workerId, benefitTypeIds, months, asOfYear, asOfMonth } = options;
  const asOfOrdinal = toOrdinal(asOfYear, asOfMonth);
  const typeSet = new Set(benefitTypeIds);

  const rows = (await storage.trust.wmb.getWorkerBenefits(
    workerId,
  )) as ContinuousCoverageHistoryRow[];
  const matching = rows.filter(
    (r) =>
      typeof r.benefit?.benefitType === "string" &&
      typeSet.has(r.benefit.benefitType) &&
      toOrdinal(r.year, r.month) <= asOfOrdinal,
  );

  const longestRun = longestConsecutiveMonths(matching);
  if (longestRun >= months) {
    return {
      met: true,
      reason: `worker held a benefit of the chosen type for ${longestRun} consecutive months on or before the evaluated date (needs ${months})`,
    };
  }
  return {
    met: false,
    reason: `longest unbroken coverage of the chosen type is ${longestRun} ${longestRun === 1 ? "month" : "months"}, but ${months} consecutive months are required`,
  };
}
