/**
 * Disability Credit eligibility — PURE core, shared between the server
 * eligibility service and the `worker.dc` access policy (shared policy files
 * must not import server modules; see the policy for the DB-backed reads).
 *
 * A worker is eligible to OPEN a DC case when either condition holds:
 *  1. FMLA months — at least BAO_DC_FMLA_REQUIRED_MONTHS (3) distinct FMLA
 *     months (intermittent OR consecutive) within the rolling
 *     BAO_DC_ROLLING_WINDOW_MONTHS (12) calendar months ending with the
 *     as-of month.
 *  2. Active denial letter — a non-voided denial letter whose DERIVED
 *     validity window (letter date .. letter date + configured validity
 *     months, end-exclusive) covers the as-of date.
 *
 * All date handling is date-only (Ymd strings) — never `new Date(ymd)`.
 * LOA is a DISTINCT input and never qualifies as FMLA.
 */
import {
  BAO_DC_FMLA_REQUIRED_MONTHS,
  BAO_DC_ROLLING_WINDOW_MONTHS,
  type BaoDcQualifyingBasis,
  type BaoDcQualifyingCondition,
} from "../../schema";
import { addMonthsYmd, type Ymd } from "../../utils/date";

/** Default months a denial letter keeps a worker eligible (config default). */
export const BAO_DC_DENIAL_LETTER_VALIDITY_MONTHS_DEFAULT = 12;

/** Pure parser for the validity-months setting. Invalid values fall back. */
export function parseDenialLetterValidityMonths(raw: unknown): number {
  const value =
    typeof raw === "number" ? raw : parseInt(String(raw ?? "").trim(), 10);
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 1 || value > 120) {
    return BAO_DC_DENIAL_LETTER_VALIDITY_MONTHS_DEFAULT;
  }
  return value;
}

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
 * as-of month (inclusive): [start, end].
 */
export function rollingWindow(asOfYmd: Ymd): { startMonthYmd: Ymd; endMonthYmd: Ymd } {
  const endMonthYmd = `${asOfYmd.slice(0, 7)}-01`;
  return {
    startMonthYmd: addMonthsYmd(endMonthYmd, -(BAO_DC_ROLLING_WINDOW_MONTHS - 1)),
    endMonthYmd,
  };
}

export interface DcDenialLetterLike {
  id: string;
  letterYmd: string;
  voidedYmd: string | null;
}

/**
 * Pure derived-expiry check: a letter is active on `asOfYmd` when it is not
 * voided and letterYmd <= asOf < letterYmd + validityMonths.
 */
export function isDenialLetterActive(
  letter: Pick<DcDenialLetterLike, "letterYmd" | "voidedYmd">,
  asOfYmd: Ymd,
  validityMonths: number,
): boolean {
  if (letter.voidedYmd) return false;
  if (letter.letterYmd > asOfYmd) return false; // future-dated letter: not yet active
  return asOfYmd < addMonthsYmd(letter.letterYmd, validityMonths);
}

/** Derived end-exclusive expiry Ymd for a letter under the given validity. */
export function denialLetterExpiryYmd(letterYmd: Ymd, validityMonths: number): Ymd {
  return addMonthsYmd(letterYmd, validityMonths);
}

export interface DcEligibilityInputs {
  asOfYmd: Ymd;
  /** DISTINCT first-of-month Ymds with positive FMLA hours (any employer). */
  fmlaMonths: Ymd[];
  denialLetters: DcDenialLetterLike[];
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
 * Upload-review helper: months strictly between consecutive FMLA months that
 * have NO reported hours rows at all.
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
