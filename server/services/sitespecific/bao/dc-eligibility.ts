/**
 * Disability Credit eligibility.
 *
 * A worker is eligible to OPEN a DC case when either condition holds:
 *  1. FMLA months — the worker has at least BAO_DC_FMLA_REQUIRED_MONTHS (3)
 *     distinct FMLA months (intermittent OR consecutive) within the rolling
 *     BAO_DC_ROLLING_WINDOW_MONTHS (12) calendar months ending with the
 *     as-of month, computed from canonical worker-hours data.
 *  2. Active denial letter — the worker has a non-voided denial letter whose
 *     DERIVED validity window (letter date .. letter date + configured
 *     validity months, end-exclusive) covers the as-of date.
 *
 * The evaluation result records WHICH condition(s) qualified; the case
 * storage snapshots that basis at open, so later hour corrections or letter
 * expiry never retroactively invalidate an existing case.
 *
 * All date handling is date-only (Ymd strings) per shared/utils/date.ts —
 * never `new Date(ymd)`.
 *
 * LOA is a DISTINCT input and never qualifies as FMLA: only statuses whose
 * normalized name or code is exactly "fmla" count.
 */
import { storage } from "../../../storage";
import {
  BAO_DC_FMLA_REQUIRED_MONTHS,
  BAO_DC_ROLLING_WINDOW_MONTHS,
  type BaoDcDenialLetter,
  type BaoDcQualifyingBasis,
  type BaoDcQualifyingCondition,
} from "@shared/schema";
import { addMonthsYmd, type Ymd } from "@shared/utils/date";
import { getDcDenialLetterValidityMonths } from "./dc-settings";

function normalizeStatus(value: string): string {
  return String(value).toLowerCase().replace(/\s+/g, "");
}

/** True when this employment-status option IS the FMLA status. LOA never matches. */
export function isFmlaStatusOption(option: { name: string; code: string | null }): boolean {
  return (
    normalizeStatus(option.name) === "fmla" ||
    normalizeStatus(option.code || "") === "fmla"
  );
}

/** True when this option is the RETIRED employer-reported Disability status. */
export function isRetiredDisabilityStatusOption(option: {
  name: string;
  code: string | null;
}): boolean {
  return (
    normalizeStatus(option.name) === "disability" ||
    normalizeStatus(option.code || "") === "disability"
  );
}

/** First-of-month Ymd for a (year, month). */
export function monthYmd(year: number, month: number): Ymd {
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

/**
 * The rolling eligibility window as first-of-month Ymds, ENDING WITH the
 * as-of month (inclusive): [start, end]. Twelve months total by default, so
 * a worker currently on FMLA gets credit for the in-progress month.
 */
export function rollingWindow(asOfYmd: Ymd): { startMonthYmd: Ymd; endMonthYmd: Ymd } {
  const endMonthYmd = `${asOfYmd.slice(0, 7)}-01`;
  return {
    startMonthYmd: addMonthsYmd(endMonthYmd, -(BAO_DC_ROLLING_WINDOW_MONTHS - 1)),
    endMonthYmd,
  };
}

/**
 * Pure derived-expiry check: a letter is active on `asOfYmd` when it is not
 * voided and letterYmd <= asOf < letterYmd + validityMonths. The expiry is
 * DERIVED from configuration at evaluation time, never persisted.
 */
export function isDenialLetterActive(
  letter: Pick<BaoDcDenialLetter, "letterYmd" | "voidedYmd">,
  asOfYmd: Ymd,
  validityMonths: number,
): boolean {
  if (letter.voidedYmd) return false;
  if (letter.letterYmd > asOfYmd) return false; // future-dated letter: not yet active
  return asOfYmd < addMonthsYmd(letter.letterYmd, validityMonths);
}

export interface DcEligibilityInputs {
  asOfYmd: Ymd;
  /** DISTINCT first-of-month Ymds with positive FMLA hours (any employer). */
  fmlaMonths: Ymd[];
  denialLetters: Array<Pick<BaoDcDenialLetter, "id" | "letterYmd" | "voidedYmd">>;
  denialLetterValidityMonths: number;
}

export interface DcEligibilityResult {
  eligible: boolean;
  conditions: BaoDcQualifyingCondition[];
  /** FMLA months inside the rolling window (sorted ascending). */
  fmlaMonthsInWindow: Ymd[];
  activeDenialLetterIds: string[];
  /** Snapshot to store on the case at open. */
  basis: BaoDcQualifyingBasis;
}

/** Pure eligibility core — fully unit-testable without a database. */
export function evaluateDcEligibility(inputs: DcEligibilityInputs): DcEligibilityResult {
  const { startMonthYmd, endMonthYmd } = rollingWindow(inputs.asOfYmd);
  const fmlaMonthsInWindow = Array.from(new Set(inputs.fmlaMonths))
    .filter((m) => m >= startMonthYmd && m <= endMonthYmd)
    .sort();
  const fmlaQualifies = fmlaMonthsInWindow.length >= BAO_DC_FMLA_REQUIRED_MONTHS;

  const activeDenialLetterIds = inputs.denialLetters
    .filter((l) => isDenialLetterActive(l, inputs.asOfYmd, inputs.denialLetterValidityMonths))
    .map((l) => l.id);

  const conditions: BaoDcQualifyingCondition[] = [];
  if (fmlaQualifies) conditions.push("fmla_months");
  if (activeDenialLetterIds.length > 0) conditions.push("denial_letter");

  return {
    eligible: conditions.length > 0,
    conditions,
    fmlaMonthsInWindow,
    activeDenialLetterIds,
    basis: {
      asOfYmd: inputs.asOfYmd,
      conditions,
      ...(fmlaQualifies ? { fmlaMonths: fmlaMonthsInWindow } : {}),
      ...(activeDenialLetterIds.length > 0
        ? { denialLetterIds: activeDenialLetterIds }
        : {}),
    },
  };
}

/**
 * Full DB-backed evaluation for a worker as of a date. Reads canonical
 * worker-hours (via the DC storage's FMLA-month read) and non-voided denial
 * letters; the validity window is derived from the current configuration.
 */
export async function computeDcEligibilityForWorker(
  workerId: string,
  asOfYmd: Ymd,
): Promise<DcEligibilityResult> {
  const { startMonthYmd, endMonthYmd } = rollingWindow(asOfYmd);
  const validityMonths = await getDcDenialLetterValidityMonths();
  const [fmlaMonths, letters] = await Promise.all([
    storage.baoDisabilityCredit.getFmlaMonthsForWorker(workerId, startMonthYmd, endMonthYmd),
    storage.baoDisabilityCredit.listNonVoidedDenialLettersForWorker(workerId),
  ]);
  return evaluateDcEligibility({
    asOfYmd,
    fmlaMonths,
    denialLetters: letters,
    denialLetterValidityMonths: validityMonths,
  });
}

/**
 * Upload-review helper: months strictly between consecutive FMLA months that
 * have NO reported hours rows at all — "unreported gaps after FMLA
 * reporting". Pure; callers supply the worker's FMLA months and the set of
 * ALL months with any reported hours (first-of-month Ymds).
 */
export function findUnreportedGapsBetweenFmlaMonths(
  fmlaMonths: Ymd[],
  reportedMonths: Ymd[],
): Ymd[] {
  const sorted = Array.from(new Set(fmlaMonths)).sort();
  if (sorted.length < 2) return [];
  const reported = new Set(reportedMonths);
  const gaps: Ymd[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    let cursor = addMonthsYmd(sorted[i], 1);
    while (cursor < sorted[i + 1]) {
      if (!reported.has(cursor)) gaps.push(cursor);
      cursor = addMonthsYmd(cursor, 1);
    }
  }
  return gaps;
}
