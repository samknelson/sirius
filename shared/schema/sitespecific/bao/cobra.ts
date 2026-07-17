/**
 * COBRA deadline calculation for the BAO component.
 *
 * All deadline dates on a COBRA case are derived from the COBRA effective
 * date (the benefit end date) and, once made, the election date. They are
 * centralized here so the rules live in exactly one place and are never
 * manually overridden.
 *
 * Rules:
 * - The offer date is the COBRA effective date.
 * - The person has 60 days from the offer date to elect coverage.
 * - Once an election is made, the first payment is due 45 days later.
 * - The maximum coverage period is 18 months for WMB-type (loss-of-hours)
 *   events and 36 months for life events. Manual cases use the 36-month
 *   life-event period.
 *
 * All dates are YMD strings (YYYY-MM-DD) and all math is done in UTC to
 * avoid timezone drift.
 */

import type { BaoCobraCaseSource } from "./schema";

export const COBRA_ELECTION_WINDOW_DAYS = 60;
export const COBRA_INITIAL_PAYMENT_WINDOW_DAYS = 45;
export const COBRA_MAX_PERIOD_MONTHS_WMB = 18;
export const COBRA_MAX_PERIOD_MONTHS_LIFE_EVENT = 36;

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseYmd(ymd: string): Date {
  if (!YMD_RE.test(ymd)) {
    throw new Error(`Invalid YMD date: ${ymd}`);
  }
  const [y, m, d] = ymd.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== m - 1 ||
    date.getUTCDate() !== d
  ) {
    throw new Error(`Invalid YMD date: ${ymd}`);
  }
  return date;
}

function formatYmd(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function addDaysYmd(ymd: string, days: number): string {
  const date = parseYmd(ymd);
  date.setUTCDate(date.getUTCDate() + days);
  return formatYmd(date);
}

/**
 * Add calendar months, clamping to the last day of the target month
 * (e.g. 2026-01-31 + 1 month = 2026-02-28).
 */
export function addMonthsYmd(ymd: string, months: number): string {
  const date = parseYmd(ymd);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
  ).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return formatYmd(date);
}

export function cobraMaxPeriodMonths(source: BaoCobraCaseSource): number {
  return source === "wmb_event"
    ? COBRA_MAX_PERIOD_MONTHS_WMB
    : COBRA_MAX_PERIOD_MONTHS_LIFE_EVENT;
}

export interface CobraDeadlines {
  /** The offer date (= the COBRA effective date). */
  offerYmd: string;
  /** Last day to elect: offer date + 60 days. */
  lastDayToElectYmd: string;
  /** First payment deadline: election date + 45 days (null until elected). */
  initialPaymentDeadlineYmd: string | null;
  /** End of the maximum coverage period (18 or 36 months from effective). */
  maxPeriodYmd: string;
}

export function computeCobraDeadlines(
  source: BaoCobraCaseSource,
  cobraEffectiveYmd: string,
  electionMadeYmd?: string | null,
): CobraDeadlines {
  const offerYmd = cobraEffectiveYmd;
  return {
    offerYmd,
    lastDayToElectYmd: addDaysYmd(offerYmd, COBRA_ELECTION_WINDOW_DAYS),
    initialPaymentDeadlineYmd: electionMadeYmd
      ? addDaysYmd(electionMadeYmd, COBRA_INITIAL_PAYMENT_WINDOW_DAYS)
      : null,
    maxPeriodYmd: addMonthsYmd(
      cobraEffectiveYmd,
      cobraMaxPeriodMonths(source),
    ),
  };
}

export const COBRA_GRACE_PERIOD_DAYS = 30;

export const COBRA_PAYMENT_STATUSES = ["paid", "grace", "delinquent"] as const;
export type CobraPaymentState = (typeof COBRA_PAYMENT_STATUSES)[number];

/**
 * Derive the payment state of a COBRA case from its COBRA ledger account
 * balance (positive = amount owed):
 *
 * - Balance <= 0 → "paid".
 * - Balance > 0 but still inside the payment window → "grace". The window is
 *   the LATER of the initial-payment deadline (election date + 45 days, for
 *   the first payment) and the standard 30-day grace period measured from the
 *   first of the current month (for periodic payments).
 * - Balance > 0 past the window → "delinquent".
 */
export function computeCobraPaymentState(
  balance: string | number,
  todayYmd: string,
  initialPaymentDeadlineYmd: string | null | undefined,
): CobraPaymentState {
  const owed = typeof balance === "number" ? balance : Number(balance);
  if (!(owed > 0)) {
    return "paid";
  }
  const firstOfMonthYmd = `${todayYmd.slice(0, 7)}-01`;
  let graceEndYmd = addDaysYmd(firstOfMonthYmd, COBRA_GRACE_PERIOD_DAYS);
  if (initialPaymentDeadlineYmd && initialPaymentDeadlineYmd > graceEndYmd) {
    graceEndYmd = initialPaymentDeadlineYmd;
  }
  return todayYmd <= graceEndYmd ? "grace" : "delinquent";
}
