/**
 * Disability Credit reporting — PURE calculations shared by the worker tab,
 * case detail, staff dashboard and trustee/upload exports so every surface
 * derives the SAME numbers from the same authoritative rows (no cached or
 * persisted counters anywhere).
 */
import { BAO_DC_ANNUAL_MONTH_LIMIT } from "../../schema";
import type { Ymd } from "../../utils/date";

/** Days before a denial letter's derived expiry that the UI must warn. */
export const BAO_DC_EXPIRY_WARNING_DAYS = 30;

/**
 * Derived annual usage from NON-REMOVED month rows: per calendar year,
 * `used` non-removed months against the annual limit. Never stored.
 */
export function buildDcYearUsage(
  applicableMonths: Array<{ workMonthYmd: string }>,
  limit: number = BAO_DC_ANNUAL_MONTH_LIMIT,
): Record<string, { used: number; limit: number }> {
  const yearUsage: Record<string, { used: number; limit: number }> = {};
  for (const m of applicableMonths) {
    const year = m.workMonthYmd.slice(0, 4);
    yearUsage[year] = yearUsage[year] ?? { used: 0, limit };
    yearUsage[year].used += 1;
  }
  return yearUsage;
}

/** Whole days from `asOfYmd` to `ymd` (negative when ymd is in the past). */
export function daysUntilYmd(ymd: Ymd, asOfYmd: Ymd): number {
  const parse = (v: string) => {
    const [y, m, d] = v.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((parse(ymd) - parse(asOfYmd)) / 86400000);
}

/** True when `expiryYmd` (end-exclusive) is within the warning window. */
export function isDcExpiryWarning(
  expiryYmd: Ymd,
  asOfYmd: Ymd,
  warningDays: number = BAO_DC_EXPIRY_WARNING_DAYS,
): boolean {
  const days = daysUntilYmd(expiryYmd, asOfYmd);
  return days > 0 && days <= warningDays;
}

// ---------------------------------------------------------------------------
// Net grant activity — derived from the append-only DC event log.
// ---------------------------------------------------------------------------

/** Event types that GRANT a DC month (writes the fund-attributed hours). */
export const BAO_DC_GRANT_EVENT_TYPES = [
  "case_month_granted",
  "case_month_released",
] as const;

export interface DcGrantActivityEventLike {
  eventType: string;
  payload: unknown;
}

export interface DcNetActivityRow {
  workMonthYmd: string;
  grants: number;
  removals: number;
  net: number;
}

function eventWorkMonth(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const v = (payload as Record<string, unknown>).workMonthYmd;
  return typeof v === "string" && /^\d{4}-\d{2}-01$/.test(v) ? v : null;
}

/** True when a `case_month_reconciled` event REMOVED the granted month. */
export function isDcRemovalEvent(event: DcGrantActivityEventLike): boolean {
  if (event.eventType !== "case_month_reconciled") return false;
  const p = (event.payload ?? {}) as Record<string, unknown>;
  return p.removed === true || Number(p.dcHours) === 0;
}

export function isDcGrantEvent(event: DcGrantActivityEventLike): boolean {
  return (BAO_DC_GRANT_EVENT_TYPES as readonly string[]).includes(event.eventType);
}

/**
 * Net grant activity per WORK month, exactly from the event log:
 * grants (granted/released) minus removals (reconciled-to-zero). A month
 * granted and later removed nets to zero; the running net for a work month
 * always equals the number of currently-granted month rows for it.
 */
export function summarizeDcGrantActivity(
  events: DcGrantActivityEventLike[],
): DcNetActivityRow[] {
  const byMonth = new Map<string, { grants: number; removals: number }>();
  for (const event of events) {
    const grant = isDcGrantEvent(event);
    const removal = isDcRemovalEvent(event);
    if (!grant && !removal) continue;
    const workMonthYmd = eventWorkMonth(event.payload);
    if (!workMonthYmd) continue;
    const entry = byMonth.get(workMonthYmd) ?? { grants: 0, removals: 0 };
    if (grant) entry.grants += 1;
    if (removal) entry.removals += 1;
    byMonth.set(workMonthYmd, entry);
  }
  return Array.from(byMonth.entries())
    .map(([workMonthYmd, { grants, removals }]) => ({
      workMonthYmd,
      grants,
      removals,
      net: grants - removals,
    }))
    .sort((a, b) => a.workMonthYmd.localeCompare(b.workMonthYmd));
}
