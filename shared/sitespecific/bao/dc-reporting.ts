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

// ---------------------------------------------------------------------------
// Annual maximum — ONE derivation for the dashboard's "Annual Maximum
// Reached" list, the worker tab, the case detail and the picker preview.
// ---------------------------------------------------------------------------

/** True when a year's non-removed month count has reached the annual limit. */
export function isDcYearMaxedOut(used: number, limit: number = BAO_DC_ANNUAL_MONTH_LIMIT): boolean {
  return used >= limit;
}

export interface DcAnnualMaxStatus {
  /** Calendar year of the WORK month (usage is counted by work month). */
  year: number;
  used: number;
  limit: number;
  maxedOut: boolean;
  /** First day the annual balance resets: Jan 1 of the following year. */
  resetsYmd: Ymd;
}

/** Maxed-out state for `currentYear` from the derived per-year usage. */
export function deriveDcAnnualMaxStatus(
  yearUsage: Record<string, { used: number; limit: number }>,
  currentYear: number,
  limit: number = BAO_DC_ANNUAL_MONTH_LIMIT,
): DcAnnualMaxStatus {
  const entry = yearUsage[String(currentYear)];
  const used = entry?.used ?? 0;
  const effectiveLimit = entry?.limit ?? limit;
  return {
    year: currentYear,
    used,
    limit: effectiveLimit,
    maxedOut: isDcYearMaxedOut(used, effectiveLimit),
    resetsYmd: `${currentYear + 1}-01-01`,
  };
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

// ---------------------------------------------------------------------------
// Post-approval visibility — per-month state and the immutable month log,
// derived ONLY from the month rows and the append-only DC event log.
// ---------------------------------------------------------------------------

const FIRST_OF_MONTH = /^\d{4}-\d{2}-01$/;

function numberOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function ymdOrNull(v: unknown): Ymd | null {
  return typeof v === "string" && FIRST_OF_MONTH.test(v) ? v : null;
}

function stringOrNull(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

export interface DcCaseMonthRowLike {
  id: string;
  caseId: string;
  workMonthYmd: string;
  status: string;
  voidReason: string | null;
  data: unknown;
}

export interface DcEventLike {
  id: string;
  eventType: string;
  caseId: string | null;
  dedupeKey: string;
  payload: unknown;
  createdAt: Date | string;
}

/** Month event types, in the order the log renders them by default. */
export const BAO_DC_MONTH_EVENT_TYPES = [
  "case_month_added",
  "case_month_queued",
  "case_month_granted",
  "case_month_released",
  "case_month_reconciled",
  "case_month_voided",
] as const;

export function isDcMonthEvent(event: Pick<DcEventLike, "eventType">): boolean {
  return (BAO_DC_MONTH_EVENT_TYPES as readonly string[]).includes(event.eventType);
}

/**
 * The month row an event belongs to: grant-path events carry `monthId` in
 * the payload; selection events (added/deselected) encode it in the dedupe
 * key (`case_month_added:<id>`, `case_month_voided:<id>`).
 */
export function dcEventMonthId(event: Pick<DcEventLike, "eventType" | "dedupeKey" | "payload">): string | null {
  if (!isDcMonthEvent(event)) return null;
  const p = (event.payload ?? {}) as Record<string, unknown>;
  const fromPayload = stringOrNull(p.monthId);
  if (fromPayload) return fromPayload;
  const parts = event.dedupeKey.split(":");
  return parts.length >= 2 && parts[0] === event.eventType ? parts[1] : null;
}

export interface DcCaseMonthState {
  id: string;
  caseId: string;
  workMonthYmd: Ymd;
  /** Stamped at grant/queue time, else the caller's derivation, else null. */
  coverageMonthYmd: Ymd | null;
  status: string;
  /** DC hours currently credited (granted rows; 0 once reconciled away). */
  grantedHours: number | null;
  /** For removed rows: the DC hours they carried before removal (null = never granted). */
  previousHours: number | null;
  threshold: number | null;
  qualifyingHoursAtGrant: number | null;
  voidReason: string | null;
  /** "approval" | "release" for granted rows. */
  via: string | null;
}

/**
 * Per-month state for a case: the stored row plus its grant snapshot, with
 * the coverage month resolved stamped-first (a queued/granted row carries the
 * lag it was granted with) and `previousHours` read from the month's own
 * reconcile/grant events so a removed month still shows what it carried.
 */
export function deriveDcCaseMonthStates(
  months: DcCaseMonthRowLike[],
  events: DcEventLike[],
  coverageFor: (workMonthYmd: Ymd) => Ymd | null = () => null,
): DcCaseMonthState[] {
  const eventsByMonth = new Map<string, DcEventLike[]>();
  for (const event of events) {
    const monthId = dcEventMonthId(event);
    if (!monthId) continue;
    const list = eventsByMonth.get(monthId) ?? [];
    list.push(event);
    eventsByMonth.set(monthId, list);
  }
  return [...months]
    .sort((a, b) => a.workMonthYmd.localeCompare(b.workMonthYmd) || a.id.localeCompare(b.id))
    .map((m) => {
      const data = (m.data && typeof m.data === "object" ? m.data : {}) as Record<string, unknown>;
      const own = (eventsByMonth.get(m.id) ?? [])
        .slice()
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      let previousHours: number | null = null;
      if (m.status === "removed") {
        const reconciled = [...own].reverse().find((e) => e.eventType === "case_month_reconciled");
        const granted = own.find(
          (e) => e.eventType === "case_month_granted" || e.eventType === "case_month_released",
        );
        const rp = (reconciled?.payload ?? {}) as Record<string, unknown>;
        const gp = (granted?.payload ?? {}) as Record<string, unknown>;
        previousHours = numberOrNull(rp.previousDcHours) ?? numberOrNull(gp.grantedHours);
      }
      return {
        id: m.id,
        caseId: m.caseId,
        workMonthYmd: m.workMonthYmd,
        coverageMonthYmd: ymdOrNull(data.coverageMonthYmd) ?? coverageFor(m.workMonthYmd),
        status: m.status,
        grantedHours: numberOrNull(data.grantedHours),
        previousHours,
        threshold: numberOrNull(data.threshold),
        qualifyingHoursAtGrant: numberOrNull(data.qualifyingHoursAtGrant),
        voidReason: m.voidReason,
        via: stringOrNull(data.via),
      };
    });
}

/**
 * Where a log entry's coverage month came from:
 *   "event" — the event's own snapshot, written with the entry (every DC
 *             month event since selection events started carrying one);
 *   "row"   — the month row's grant/queue stamp (older events that predate
 *             the payload snapshot);
 *   "live"  — the caller's CURRENT plan-lag derivation, the one source a
 *             later rule change can move (legacy selection/void events only).
 */
export type DcMonthHistoryCoverageSource = "event" | "row" | "live";

export interface DcMonthHistoryEntry {
  id: string;
  at: Date | string;
  eventType: string;
  monthId: string | null;
  workMonthYmd: Ymd | null;
  coverageMonthYmd: Ymd | null;
  /** How `coverageMonthYmd` was resolved; null when nothing resolved it. */
  coverageSource: DcMonthHistoryCoverageSource | null;
  /** DC hours on the work month before/after the event (null = not an hours event). */
  hoursBefore: number | null;
  hoursAfter: number | null;
  reason: string | null;
  actorUserId: string | null;
  /** True when the event removed the month from the annual count. */
  removed: boolean;
}

/**
 * Chronological month log for a case (the spec's immutable auto-generated
 * entries): grant/queue/release/reconcile/void/select events with the DC
 * hours before and after each. Payload conventions:
 *   granted/released  → 0 → grantedHours
 *   reconciled        → previousDcHours → dcHours
 *   voided (no_shortfall) → 0 → 0 ; voided (deselected) → no hours
 *   queued / added    → no hours
 * The coverage month is read from the event's own snapshot whenever the
 * payload carries the key (a `null` there means "unresolvable when written"
 * and stays null); `coverageFor` is consulted only for legacy events with no
 * snapshot and no row stamp — see {@link DcMonthHistoryCoverageSource}.
 */
export function deriveDcMonthHistory(
  events: DcEventLike[],
  months: DcCaseMonthRowLike[],
  coverageFor: (workMonthYmd: Ymd) => Ymd | null = () => null,
): DcMonthHistoryEntry[] {
  const monthById = new Map(months.map((m) => [m.id, m]));
  return events
    .filter(isDcMonthEvent)
    .map((event) => {
      const p = (event.payload ?? {}) as Record<string, unknown>;
      const monthId = dcEventMonthId(event);
      const row = monthId ? monthById.get(monthId) : undefined;
      const rowData = (row?.data && typeof row.data === "object" ? row.data : {}) as Record<
        string,
        unknown
      >;
      let hoursBefore: number | null = null;
      let hoursAfter: number | null = null;
      let removed = false;
      let reason: string | null = null;
      switch (event.eventType) {
        case "case_month_granted":
        case "case_month_released":
          hoursBefore = 0;
          hoursAfter = numberOrNull(p.grantedHours);
          break;
        case "case_month_reconciled":
          hoursBefore = numberOrNull(p.previousDcHours);
          hoursAfter = numberOrNull(p.dcHours);
          removed = p.removed === true || hoursAfter === 0;
          break;
        case "case_month_voided":
          removed = true;
          reason = stringOrNull(p.reason);
          if (reason === "no_shortfall") {
            hoursBefore = 0;
            hoursAfter = 0;
          }
          break;
        default:
          break;
      }
      const workMonthYmd = ymdOrNull(p.workMonthYmd) ?? (row ? row.workMonthYmd : null);
      let coverageMonthYmd: Ymd | null = null;
      let coverageSource: DcMonthHistoryCoverageSource | null = null;
      if (Object.prototype.hasOwnProperty.call(p, "coverageMonthYmd")) {
        coverageMonthYmd = ymdOrNull(p.coverageMonthYmd);
        coverageSource = "event";
      } else if (ymdOrNull(rowData.coverageMonthYmd)) {
        coverageMonthYmd = ymdOrNull(rowData.coverageMonthYmd);
        coverageSource = "row";
      } else if (workMonthYmd) {
        coverageMonthYmd = coverageFor(workMonthYmd);
        coverageSource = coverageMonthYmd ? "live" : null;
      }
      return {
        id: event.id,
        at: event.createdAt,
        eventType: event.eventType,
        monthId,
        workMonthYmd,
        coverageMonthYmd,
        coverageSource,
        hoursBefore,
        hoursAfter,
        reason,
        actorUserId: stringOrNull(p.actorUserId),
        removed,
      };
    })
    .sort(
      (a, b) =>
        new Date(a.at).getTime() - new Date(b.at).getTime() || a.id.localeCompare(b.id),
    );
}
