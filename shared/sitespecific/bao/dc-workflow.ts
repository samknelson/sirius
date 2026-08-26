/**
 * Disability Credit case workflow — PURE logic shared by server (storage
 * enforcement, routes) and client (previews, disabled-state hints).
 *
 * - Lifecycle transition map (who may act is enforced by routes; the shape
 *   of legal transitions lives here so both sides agree).
 * - Documentation checklist: COMPUTED from current (non-superseded)
 *   documents + staff attestations. Names every missing item.
 * - Month selection validation: coverage continuity (gap months named) and
 *   per-year annual capacity across ALL of the worker's cases, including
 *   year-boundary handling.
 */
import {
  BAO_DC_ANNUAL_MONTH_LIMIT,
  type BaoDcAttestations,
  type BaoDcCaseStatus,
  type BaoDcDocumentType,
} from "../../schema";
import { addMonthsYmd, type Ymd } from "../../utils/date";

// ---------------------------------------------------------------------------
// Lifecycle transitions
// ---------------------------------------------------------------------------

/** Legal case-status transitions. Terminal states have no exits. */
export const BAO_DC_CASE_TRANSITIONS: Record<BaoDcCaseStatus, BaoDcCaseStatus[]> = {
  draft: ["ready_for_review", "withdrawn", "void"],
  ready_for_review: ["in_queue", "draft", "withdrawn", "void"],
  in_queue: ["approved", "denied", "draft", "withdrawn", "void"],
  approved: [],
  denied: [],
  withdrawn: [],
  void: [],
};

export function isDcTransitionAllowed(
  from: BaoDcCaseStatus,
  to: BaoDcCaseStatus,
): boolean {
  return (BAO_DC_CASE_TRANSITIONS[from] ?? []).includes(to);
}

// ---------------------------------------------------------------------------
// Documentation checklist
// ---------------------------------------------------------------------------

export interface DcChecklistDocLike {
  docType: BaoDcDocumentType;
  /** Superseded documents no longer satisfy anything. */
  supersededAt: Date | string | null;
}

export interface DcChecklistItem {
  key: string;
  label: string;
  satisfied: boolean;
  /** Extra context (e.g. HOW an item is satisfied via the unsigned branch). */
  detail?: string;
}

export interface DcChecklistResult {
  items: DcChecklistItem[];
  passing: boolean;
  /** Labels of every unsatisfied item — readiness must name what's missing. */
  missing: string[];
}

/**
 * Compute the documentation checklist from CURRENT documents plus staff
 * attestations. The system never reads document contents — signedness,
 * field completeness and the restrictions flag are staff-attested facts.
 */
export function computeDcChecklist(
  docs: DcChecklistDocLike[],
  attestations: BaoDcAttestations | null | undefined,
): DcChecklistResult {
  const att = attestations ?? {};
  const current = docs.filter((d) => !d.supersededAt);
  const has = (t: BaoDcDocumentType) => current.some((d) => d.docType === t);

  const hasForm = has("dc_form");
  const hasSupportingNote = has("wsr") || has("doctor_note");

  const items: DcChecklistItem[] = [];

  items.push({
    key: "dc_form_present",
    label: "DC form on file",
    satisfied: hasForm,
  });

  const signed = att.signed === true;
  items.push({
    key: "form_signed",
    label: "DC form doctor-signed (or unsigned form with a WSR or doctor's note)",
    satisfied: signed || (hasForm && hasSupportingNote),
    detail: signed
      ? "Staff attested the form is doctor-signed"
      : hasForm && hasSupportingNote
        ? "Unsigned form accompanied by a WSR / doctor's note"
        : undefined,
  });

  const fields = att.fields ?? {};
  items.push({
    key: "field_doctor_address",
    label: "Form field: doctor address",
    satisfied: fields.doctorAddress === true,
  });
  items.push({
    key: "field_doctor_phone",
    label: "Form field: doctor phone",
    satisfied: fields.doctorPhone === true,
  });
  items.push({
    key: "field_dates",
    label: "Form field: dates",
    satisfied: fields.dates === true,
  });

  if (att.restrictionsNoted === true) {
    items.push({
      key: "employer_accommodation_letter",
      label: "Employer inability-to-accommodate letter (restrictions noted)",
      satisfied: has("employer_accommodation_letter"),
    });
  }

  const missing = items.filter((i) => !i.satisfied).map((i) => i.label);
  return { items, passing: missing.length === 0, missing };
}

// ---------------------------------------------------------------------------
// Month selection
// ---------------------------------------------------------------------------

const FIRST_OF_MONTH = /^\d{4}-\d{2}-01$/;

function monthOrdinal(ymd: Ymd): number {
  const [y, m] = ymd.split("-").map(Number);
  return y * 12 + (m - 1);
}

export type DcSelectionErrorCode =
  | "EMPTY_SELECTION"
  | "NOT_FIRST_OF_MONTH"
  | "ALREADY_COVERED"
  | "CONFLICTING_CASE_MONTH"
  | "CONTINUITY_GAP"
  | "CAPACITY_EXCEEDED";

export interface DcSelectionError {
  code: DcSelectionErrorCode;
  message: string;
  months?: Ymd[];
  year?: number;
}

export interface DcSelectionYearUsage {
  /** Non-removed DC months from OTHER cases in this year. */
  used: number;
  /** Months in the proposed selection landing in this year. */
  selected: number;
  limit: number;
  remaining: number;
}

export interface DcSelectionValidation {
  ok: boolean;
  errors: DcSelectionError[];
  /** Continuity gap months that would have to be backfilled (named). */
  gapMonths: Ymd[];
  perYear: Record<string, DcSelectionYearUsage>;
}

export interface DcSelectionInputs {
  /** Proposed FULL month set for this case (first-of-month Ymds). */
  selectedMonths: Ymd[];
  /** Non-removed DC months on the worker's OTHER cases. */
  otherCaseMonths: Ymd[];
  /** Months the worker already has coverage for (WMB presence). */
  coveredMonths: Ymd[];
  annualLimit?: number;
}

/**
 * Validate a proposed multi-month selection.
 *
 * Continuity: the selection plus existing coverage (and other-case DC
 * months) must form a continuous run — the first credited month must
 * immediately follow the worker's last covered month, or the selection must
 * backfill every gap month back to it. Violations NAME the gap months.
 *
 * Capacity: per calendar year (year boundaries handled independently), the
 * worker's non-removed DC months across all cases plus this selection must
 * not exceed the annual limit. A required backfill larger than the remaining
 * capacity therefore blocks the selection.
 */
export function validateDcMonthSelection(inputs: DcSelectionInputs): DcSelectionValidation {
  const limit = inputs.annualLimit ?? BAO_DC_ANNUAL_MONTH_LIMIT;
  const errors: DcSelectionError[] = [];
  const selected = Array.from(new Set(inputs.selectedMonths)).sort();
  const covered = new Set(inputs.coveredMonths);
  const other = new Set(inputs.otherCaseMonths);

  if (selected.length === 0) {
    errors.push({ code: "EMPTY_SELECTION", message: "At least one month must be selected." });
    return { ok: false, errors, gapMonths: [], perYear: {} };
  }

  const badFormat = selected.filter((m) => !FIRST_OF_MONTH.test(m));
  if (badFormat.length > 0) {
    errors.push({
      code: "NOT_FIRST_OF_MONTH",
      message: `Months must be first-of-month dates: ${badFormat.join(", ")}`,
      months: badFormat,
    });
    return { ok: false, errors, gapMonths: [], perYear: {} };
  }

  const alreadyCovered = selected.filter((m) => covered.has(m));
  if (alreadyCovered.length > 0) {
    errors.push({
      code: "ALREADY_COVERED",
      message: `Already covered — no Disability Credit needed: ${alreadyCovered.join(", ")}`,
      months: alreadyCovered,
    });
  }

  const conflicting = selected.filter((m) => other.has(m));
  if (conflicting.length > 0) {
    errors.push({
      code: "CONFLICTING_CASE_MONTH",
      message: `Held by another case for this worker: ${conflicting.join(", ")}`,
      months: conflicting,
    });
  }

  // Continuity — walk every month that must be accounted for and name holes.
  const inUnion = (m: Ymd) => covered.has(m) || other.has(m) || selected.includes(m);
  const allKnown = [...covered, ...other];
  const lastCovered =
    allKnown.length > 0 ? allKnown.reduce((a, b) => (a > b ? a : b)) : null;

  const first = selected[0];
  const last = selected[selected.length - 1];
  let walkStart = first;
  if (lastCovered && monthOrdinal(first) > monthOrdinal(lastCovered) + 1) {
    walkStart = addMonthsYmd(lastCovered, 1);
  }
  const gapMonths: Ymd[] = [];
  for (
    let cursor = walkStart;
    monthOrdinal(cursor) <= monthOrdinal(last);
    cursor = addMonthsYmd(cursor, 1)
  ) {
    if (!inUnion(cursor)) gapMonths.push(cursor);
  }
  if (gapMonths.length > 0) {
    errors.push({
      code: "CONTINUITY_GAP",
      message: `Selection leaves coverage gaps — these months must be backfilled or covered: ${gapMonths.join(", ")}`,
      months: gapMonths,
    });
  }

  // Capacity — per calendar year, across ALL the worker's cases.
  const perYear: Record<string, DcSelectionYearUsage> = {};
  const years = new Set<number>([
    ...selected.map((m) => Number(m.slice(0, 4))),
    ...inputs.otherCaseMonths.map((m) => Number(m.slice(0, 4))),
  ]);
  for (const year of Array.from(years).sort()) {
    const used = inputs.otherCaseMonths.filter(
      (m) => Number(m.slice(0, 4)) === year,
    ).length;
    const chosen = selected.filter((m) => Number(m.slice(0, 4)) === year).length;
    perYear[String(year)] = {
      used,
      selected: chosen,
      limit,
      remaining: Math.max(0, limit - used - chosen),
    };
    if (used + chosen > limit) {
      errors.push({
        code: "CAPACITY_EXCEEDED",
        message: `${year}: ${used + chosen} Disability Credit months would exceed the annual limit of ${limit}.`,
        year,
      });
    }
  }

  return { ok: errors.length === 0, errors, gapMonths, perYear };
}
