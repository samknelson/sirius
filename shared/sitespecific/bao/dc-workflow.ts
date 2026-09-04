/**
 * Disability Credit case workflow — PURE logic shared by server (storage
 * enforcement, routes) and client (previews, disabled-state hints).
 *
 * - Lifecycle transition map (who may act is enforced by routes; the shape
 *   of legal transitions lives here so both sides agree).
 * - Documentation checklist: COMPUTED from current (non-superseded)
 *   documents + staff attestations. Names every missing item.
 * - Month selection validation on the COVERAGE axis: continuity (gap
 *   coverage months named), already-covered / before-first-coverage rules,
 *   and per-year annual capacity (by work month) across ALL of the worker's
 *   cases, including year-boundary handling.
 * - Guided picker options: every option carries the coverage month (what
 *   the Fund approves) AND the work month (what the case stores).
 */
import {
  BAO_DC_ANNUAL_MONTH_LIMIT,
  type BaoDcAttestations,
  type BaoDcCaseStatus,
  type BaoDcDocumentType,
} from "../../schema";
import { addMonthsYmd, formatYmdMonth, type Ymd } from "../../utils/date";

// ---------------------------------------------------------------------------
// Lifecycle transitions
// ---------------------------------------------------------------------------

/**
 * Legal case-status transitions. Terminal states have no exits.
 *
 * Preparation collapses into ONE handoff: draft → in_queue (Send for
 * Approval). `ready_for_review` is LEGACY — nothing enters it anymore, but
 * existing cases in that state keep their exits (send for approval, return
 * to draft, withdraw, void) so they never strand.
 */
export const BAO_DC_CASE_TRANSITIONS: Record<BaoDcCaseStatus, BaoDcCaseStatus[]> = {
  draft: ["in_queue", "withdrawn", "void"],
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

  // Upload/classification alone never satisfies this item — a reviewer must
  // manually attest they checked the classified DC form (dcFormOnFile).
  const formAttested = att.dcFormOnFile === true;
  items.push({
    key: "dc_form_present",
    label: "DC form on file",
    satisfied: hasForm && formAttested,
    detail: hasForm
      ? formAttested
        ? "Staff verified the classified DC form"
        : "A DC form is classified but staff have not verified it"
      : undefined,
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
// Month selection — the COVERAGE axis
// ---------------------------------------------------------------------------
//
// The Fund approves Disability Credit for COVERAGE months; the system
// translates each one to the WORK month that receives the credited hours
// (coverage month − the plan's lag). The case stores the work month (the
// DB key never changes), so every month in this section travels as a
// `DcMonthRef` pair and:
//
//   - "already covered", "before first coverage" and continuity are decided
//     on the coverage axis (a coverage month counts as covered when WMB
//     shows it OR its work month's qualifying hours already meet the plan
//     minimum);
//   - annual capacity is counted by the WORK month's calendar year, exactly
//     as the stored usage counters do;
//   - conflicts with other cases are checked on both keys.
//
// Nothing here resolves lag or minimums — the server's month map derives
// them once per worker with the grant service's own requirement resolver
// and hands the pairs in, so the picker, the validator and the approval can
// never disagree.

const FIRST_OF_MONTH = /^\d{4}-\d{2}-01$/;

function monthOrdinal(ymd: Ymd): number {
  const [y, m] = ymd.split("-").map(Number);
  return y * 12 + (m - 1);
}

function isFirstOfMonth(ymd: unknown): ymd is Ymd {
  return typeof ymd === "string" && FIRST_OF_MONTH.test(ymd);
}

/** Hours for display: whole numbers stay whole, fractions keep ≤2 decimals. */
export function formatDcHours(hours: number): string {
  return Number.isInteger(hours) ? String(hours) : String(Number(hours.toFixed(2)));
}

/** "October 2026 coverage (work month July 2026)". */
export function describeDcMonthRef(ref: { workMonthYmd: Ymd; coverageMonthYmd: Ymd | null }): string {
  if (!ref.coverageMonthYmd) return `work month ${formatYmdMonth(ref.workMonthYmd)} (coverage month unknown)`;
  return `${formatYmdMonth(ref.coverageMonthYmd)} coverage (work month ${formatYmdMonth(ref.workMonthYmd)})`;
}

/** A credited month seen on both axes. */
export interface DcMonthRef {
  /** Stored key: first day of the work month that receives the hours. */
  workMonthYmd: Ymd;
  /** First day of the coverage month the credit continues (work + lag). */
  coverageMonthYmd: Ymd;
}

/** A non-removed month on one of the worker's OTHER cases. */
export interface DcOtherCaseMonth {
  workMonthYmd: Ymd;
  /**
   * null when the lag for that month cannot be resolved: the month still
   * consumes annual capacity and blocks its work month, but cannot take part
   * in coverage-axis continuity.
   */
  coverageMonthYmd: Ymd | null;
}

export type DcSelectionErrorCode =
  | "EMPTY_SELECTION"
  | "NOT_FIRST_OF_MONTH"
  | "UNRESOLVABLE_MONTH"
  | "DUPLICATE_COVERAGE_MONTH"
  | "ALREADY_COVERED"
  | "CONFLICTING_CASE_MONTH"
  | "CONTINUITY_GAP"
  | "CAPACITY_EXCEEDED"
  | "NO_PRIOR_COVERAGE"
  | "BEFORE_FIRST_COVERAGE";

export interface DcSelectionError {
  code: DcSelectionErrorCode;
  message: string;
  /** Coverage months the error is about (work months for UNRESOLVABLE_MONTH). */
  months?: Ymd[];
  /** The work months paired with `months`, where known. */
  workMonths?: Ymd[];
  year?: number;
}

export interface DcSelectionYearUsage {
  /** Non-removed DC months from OTHER cases whose WORK month is in this year. */
  used: number;
  /** Months in the proposed selection whose WORK month is in this year. */
  selected: number;
  limit: number;
  remaining: number;
}

export interface DcSelectionValidation {
  ok: boolean;
  errors: DcSelectionError[];
  /** Continuity gap COVERAGE months that would have to be backfilled (named). */
  gapMonths: Ymd[];
  /** Per WORK-month calendar year. */
  perYear: Record<string, DcSelectionYearUsage>;
}

export interface DcSelectionInputs {
  /** Proposed FULL month set for this case, on both axes. */
  selectedMonths: DcMonthRef[];
  /** Non-removed DC months on the worker's OTHER cases. */
  otherCaseMonths: DcOtherCaseMonth[];
  /**
   * COVERAGE months already covered: WMB months plus the coverage months of
   * work months whose qualifying hours already meet the plan minimum.
   */
  coveredMonths: Ymd[];
  /**
   * Known work→coverage pairs for the worker (the month map), used only to
   * name the work month alongside each gap coverage month.
   */
  candidateMonths?: Array<{ workMonthYmd: Ymd; coverageMonthYmd: Ymd | null }>;
  annualLimit?: number;
}

function ordinalToYmd(ordinal: number): Ymd {
  const y = Math.floor(ordinal / 12);
  const m = (ordinal % 12) + 1;
  return `${y}-${String(m).padStart(2, "0")}-01`;
}

/**
 * Validate a proposed multi-month selection.
 *
 * Continuity (coverage axis): the selected coverage months plus existing
 * coverage (and other-case DC coverage months) must form a continuous run —
 * the first credited coverage month must immediately follow the worker's
 * last covered month, or the selection must backfill every gap back to it.
 * Violations NAME the gap coverage months (with their work months).
 *
 * Capacity (work-month calendar year, year boundaries independent): the
 * worker's non-removed DC months across all cases plus this selection must
 * not exceed the annual limit. A required backfill larger than the remaining
 * capacity therefore blocks the selection.
 */
export function validateDcMonthSelection(inputs: DcSelectionInputs): DcSelectionValidation {
  const limit = inputs.annualLimit ?? BAO_DC_ANNUAL_MONTH_LIMIT;
  const errors: DcSelectionError[] = [];

  if (inputs.selectedMonths.length === 0) {
    errors.push({ code: "EMPTY_SELECTION", message: "Select at least one month." });
    return { ok: false, errors, gapMonths: [], perYear: {} };
  }

  const malformed = inputs.selectedMonths.filter(
    (m) => !isFirstOfMonth(m.workMonthYmd) || !isFirstOfMonth(m.coverageMonthYmd),
  );
  if (malformed.length > 0) {
    errors.push({
      code: "NOT_FIRST_OF_MONTH",
      message: `Months must be the first day of a month: ${malformed.map((m) => m.workMonthYmd).join(", ")}`,
      months: malformed.map((m) => m.workMonthYmd),
    });
    return { ok: false, errors, gapMonths: [], perYear: {} };
  }

  // One entry per work month (the stored key), ordered on the coverage axis.
  const byWork = new Map<Ymd, DcMonthRef>();
  for (const m of inputs.selectedMonths) byWork.set(m.workMonthYmd, m);
  const selected = Array.from(byWork.values()).sort(
    (a, b) => monthOrdinal(a.coverageMonthYmd) - monthOrdinal(b.coverageMonthYmd)
      || monthOrdinal(a.workMonthYmd) - monthOrdinal(b.workMonthYmd),
  );

  const duplicateCoverage = new Map<Ymd, DcMonthRef[]>();
  for (const m of selected) {
    const list = duplicateCoverage.get(m.coverageMonthYmd) ?? [];
    list.push(m);
    duplicateCoverage.set(m.coverageMonthYmd, list);
  }
  const duplicates = Array.from(duplicateCoverage.values()).filter((l) => l.length > 1);
  if (duplicates.length > 0) {
    errors.push({
      code: "DUPLICATE_COVERAGE_MONTH",
      message: `Two selected work months would credit the same coverage month: ${duplicates
        .map((l) => `${formatYmdMonth(l[0].coverageMonthYmd)} coverage (work months ${l
          .map((m) => formatYmdMonth(m.workMonthYmd))
          .join(", ")})`)
        .join("; ")}`,
      months: duplicates.map((l) => l[0].coverageMonthYmd),
      workMonths: duplicates.flatMap((l) => l.map((m) => m.workMonthYmd)),
    });
  }

  const covered = new Set(inputs.coveredMonths);
  const otherWork = new Set(inputs.otherCaseMonths.map((m) => m.workMonthYmd));
  const otherCoverage = new Set(
    inputs.otherCaseMonths.map((m) => m.coverageMonthYmd).filter((c): c is Ymd => c !== null),
  );
  const workByCoverage = new Map<Ymd, Ymd>();
  for (const c of inputs.candidateMonths ?? []) {
    if (c.coverageMonthYmd && !workByCoverage.has(c.coverageMonthYmd)) {
      workByCoverage.set(c.coverageMonthYmd, c.workMonthYmd);
    }
  }
  const describeCoverage = (coverageMonthYmd: Ymd): string => {
    const work = workByCoverage.get(coverageMonthYmd);
    return work
      ? `${formatYmdMonth(coverageMonthYmd)} (work month ${formatYmdMonth(work)})`
      : formatYmdMonth(coverageMonthYmd);
  };

  const alreadyCovered = selected.filter((m) => covered.has(m.coverageMonthYmd));
  if (alreadyCovered.length > 0) {
    errors.push({
      code: "ALREADY_COVERED",
      message: `Already covered — no Disability Credit needed: ${alreadyCovered
        .map(describeDcMonthRef)
        .join("; ")}`,
      months: alreadyCovered.map((m) => m.coverageMonthYmd),
      workMonths: alreadyCovered.map((m) => m.workMonthYmd),
    });
  }

  // Disability Credit CONTINUES coverage: a worker with no established
  // coverage month has nothing to continue, and no credited coverage month
  // may fall at or before the first established one.
  const coveredOrdinals = Array.from(covered).map(monthOrdinal);
  const firstCovered = coveredOrdinals.length > 0 ? Math.min(...coveredOrdinals) : null;
  if (firstCovered === null) {
    errors.push({
      code: "NO_PRIOR_COVERAGE",
      message:
        "Disability Credit can only extend existing coverage — this worker has no established coverage month.",
    });
  } else {
    const tooEarly = selected.filter(
      (m) => monthOrdinal(m.coverageMonthYmd) <= firstCovered && !covered.has(m.coverageMonthYmd),
    );
    if (tooEarly.length > 0) {
      errors.push({
        code: "BEFORE_FIRST_COVERAGE",
        message: `At or before the worker's first established coverage month (${formatYmdMonth(
          ordinalToYmd(firstCovered),
        )}): ${tooEarly.map(describeDcMonthRef).join("; ")}`,
        months: tooEarly.map((m) => m.coverageMonthYmd),
        workMonths: tooEarly.map((m) => m.workMonthYmd),
      });
    }
  }

  const conflicting = selected.filter(
    (m) => otherWork.has(m.workMonthYmd) || otherCoverage.has(m.coverageMonthYmd),
  );
  if (conflicting.length > 0) {
    errors.push({
      code: "CONFLICTING_CASE_MONTH",
      message: `Already held by another Disability Credit case for this worker: ${conflicting
        .map(describeDcMonthRef)
        .join("; ")}`,
      months: conflicting.map((m) => m.coverageMonthYmd),
      workMonths: conflicting.map((m) => m.workMonthYmd),
    });
  }

  // Continuity on the coverage axis: walk from the month after the last
  // covered month (or from the first selected month when it lies inside
  // existing coverage) through the last selected month; every month must be
  // covered, a DC month on another case, or in this selection.
  const gapMonths: Ymd[] = [];
  const unionCoverage = new Set<Ymd>([
    ...covered,
    ...otherCoverage,
    ...selected.map((m) => m.coverageMonthYmd),
  ]);
  const anchorOrdinals = [...covered, ...otherCoverage].map(monthOrdinal);
  const lastCovered = anchorOrdinals.length > 0 ? Math.max(...anchorOrdinals) : null;
  const firstSelected = monthOrdinal(selected[0].coverageMonthYmd);
  const lastSelected = monthOrdinal(selected[selected.length - 1].coverageMonthYmd);
  const walkFrom = lastCovered !== null && firstSelected > lastCovered + 1 ? lastCovered + 1 : firstSelected;
  for (let o = walkFrom; o <= lastSelected; o += 1) {
    const ymd = ordinalToYmd(o);
    if (!unionCoverage.has(ymd)) gapMonths.push(ymd);
  }
  if (gapMonths.length > 0) {
    errors.push({
      code: "CONTINUITY_GAP",
      message: `Selection leaves coverage gaps — these coverage months must be backfilled or covered: ${gapMonths
        .map(describeCoverage)
        .join(", ")}`,
      months: gapMonths,
      workMonths: gapMonths.map((c) => workByCoverage.get(c)).filter((w): w is Ymd => w !== undefined),
    });
  }

  // Annual capacity — by the WORK month's calendar year (year boundaries
  // handled independently), across all of the worker's non-removed months.
  const perYear: Record<string, DcSelectionYearUsage> = {};
  const usedByYear = new Map<number, number>();
  for (const m of inputs.otherCaseMonths) {
    const y = Number(m.workMonthYmd.slice(0, 4));
    usedByYear.set(y, (usedByYear.get(y) ?? 0) + 1);
  }
  const selectedByYear = new Map<number, number>();
  for (const m of selected) {
    const y = Number(m.workMonthYmd.slice(0, 4));
    selectedByYear.set(y, (selectedByYear.get(y) ?? 0) + 1);
  }
  const years = new Set<number>([...usedByYear.keys(), ...selectedByYear.keys()]);
  for (const y of Array.from(years).sort()) {
    const used = usedByYear.get(y) ?? 0;
    const chosen = selectedByYear.get(y) ?? 0;
    perYear[String(y)] = { used, selected: chosen, limit, remaining: Math.max(0, limit - used - chosen) };
    if (used + chosen > limit) {
      errors.push({
        code: "CAPACITY_EXCEEDED",
        message: `${y}: ${used + chosen} Disability Credit months (counted by work month) would exceed the annual limit of ${limit}.`,
        year: y,
      });
    }
  }

  return { ok: errors.length === 0, errors, gapMonths, perYear };
}

// ---------------------------------------------------------------------------
// Guided month picker options
// ---------------------------------------------------------------------------

/** Picker window: this many months back from the current month … */
export const BAO_DC_OPTION_LOOKBACK_MONTHS = 12;
/** … and this many months forward. Active case months are always included. */
export const BAO_DC_OPTION_FUTURE_MONTHS = 8;

function firstOfMonth(ymd: Ymd): Ymd {
  return `${ymd.slice(0, 7)}-01`;
}

/**
 * The work months a picker enumerates for a worker: the window around the
 * current month plus every extra month that must be shown regardless
 * (active months of the case being edited, months held by other cases, a
 * proposed selection). Sorted, de-duplicated, first-of-month keys.
 */
export function enumerateDcCandidateWorkMonths(nowMonthYmd: Ymd, extraWorkMonths: Ymd[] = []): Ymd[] {
  const now = firstOfMonth(nowMonthYmd);
  const months = new Set<Ymd>();
  for (let i = -BAO_DC_OPTION_LOOKBACK_MONTHS; i <= BAO_DC_OPTION_FUTURE_MONTHS; i += 1) {
    months.add(addMonthsYmd(now, i));
  }
  for (const m of extraWorkMonths) if (isFirstOfMonth(m)) months.add(m);
  return Array.from(months).sort();
}

/**
 * One enumerated work month with everything the server's month map could
 * derive for it. `coverageMonthYmd`/`threshold` are null when the plan lag
 * or minimum could not be resolved; `unavailable` then names why.
 */
export interface DcMonthCandidate {
  workMonthYmd: Ymd;
  coverageMonthYmd: Ymd | null;
  /** Plan minimum for the work month (the continuation threshold). */
  threshold: number | null;
  /** Qualifying employer/FMLA hours already reported for the work month. */
  qualifyingHours: number;
  unavailable?: {
    code: string;
    message: string;
    /** The worker has no established coverage at or before this work month. */
    noContinuedBenefits?: boolean;
  };
}

/** Shortfall the grant would credit for a candidate; null when unknown. */
export function dcCandidateShortfall(c: Pick<DcMonthCandidate, "threshold" | "qualifyingHours">): number | null {
  if (c.threshold === null) return null;
  return Math.max(0, c.threshold - c.qualifyingHours);
}

/**
 * The coverage-axis covered set: WMB coverage months plus the coverage
 * months of every candidate work month whose qualifying hours already meet
 * the plan minimum (those months need no Disability Credit).
 */
export function deriveDcCoveredCoverageMonths(
  wmbCoverageMonths: Ymd[],
  candidates: DcMonthCandidate[],
): Ymd[] {
  const covered = new Set<Ymd>(wmbCoverageMonths.map(firstOfMonth));
  for (const c of candidates) {
    if (c.coverageMonthYmd !== null && dcCandidateShortfall(c) === 0) covered.add(c.coverageMonthYmd);
  }
  return Array.from(covered).sort();
}

export type DcMonthOptionStatus =
  | "available"
  | "selected"
  | "covered"
  | "not_grantable"
  | "conflicting"
  | "unavailable";

export interface DcMonthOption {
  /** Stored/API key — the client submits THIS for a chosen option. */
  workMonthYmd: Ymd;
  /** Primary label axis; null when the lag could not be resolved. */
  coverageMonthYmd: Ymd | null;
  status: DcMonthOptionStatus;
  /** Whether staff may toggle this month in the picker. */
  selectable: boolean;
  /** Why the month is not available, or a caution for a selected month. */
  reason?: string;
  threshold: number | null;
  qualifyingHours: number;
  shortfall: number | null;
  /** "X of Y hours reported — Disability Credit adds Z" when known. */
  detail?: string;
}

export interface DcMonthOptionInputs {
  /** Enumerated work months with their derived coverage data. */
  candidates: DcMonthCandidate[];
  /** Coverage months WMB shows as covered. */
  wmbCoverageMonths: Ymd[];
  /** Non-removed months on the worker's OTHER cases. */
  otherCaseMonths: DcOtherCaseMonth[];
  /** This case's ACTIVE (non-removed) months — work-month keys. */
  activeCaseMonths: Ymd[];
}

function hoursDetail(c: DcMonthCandidate): string | undefined {
  const shortfall = dcCandidateShortfall(c);
  if (shortfall === null || c.threshold === null) return undefined;
  const reported = `${formatDcHours(c.qualifyingHours)} of ${formatDcHours(c.threshold)} hours reported`;
  return shortfall > 0
    ? `${reported} — Disability Credit adds ${formatDcHours(shortfall)}`
    : `${reported} — no Disability Credit needed`;
}

/**
 * Guided picker options over the enumerated candidates. Each option carries
 * both keys; the client must submit `workMonthYmd` and never translate
 * itself. Classification, in priority order:
 *   selected (this case's active months, with a caution when the month will
 *   be voided at approval) → unavailable (lag/minimum unresolvable) →
 *   conflicting (held by another case) → covered (WMB) → not_grantable
 *   (employer hours already meet the minimum) → unavailable (no coverage to
 *   continue / at or before first coverage) → available.
 */
export function computeDcMonthOptions(inputs: DcMonthOptionInputs): DcMonthOption[] {
  const active = new Set(inputs.activeCaseMonths.map(firstOfMonth));
  const wmb = new Set(inputs.wmbCoverageMonths.map(firstOfMonth));
  const otherWork = new Set(inputs.otherCaseMonths.map((m) => m.workMonthYmd));
  const otherCoverage = new Set(
    inputs.otherCaseMonths.map((m) => m.coverageMonthYmd).filter((c): c is Ymd => c !== null),
  );
  const covered = deriveDcCoveredCoverageMonths(inputs.wmbCoverageMonths, inputs.candidates);
  const firstCovered = covered.length > 0 ? monthOrdinal(covered[0]) : null;
  const firstWmb = wmb.size > 0 ? Array.from(wmb).sort()[0] : null;

  const options: DcMonthOption[] = [];
  const sorted = [...inputs.candidates].sort((a, b) => a.workMonthYmd.localeCompare(b.workMonthYmd));
  for (const c of sorted) {
    const shortfall = dcCandidateShortfall(c);
    const base = {
      workMonthYmd: c.workMonthYmd,
      coverageMonthYmd: c.coverageMonthYmd,
      threshold: c.threshold,
      qualifyingHours: c.qualifyingHours,
      shortfall,
      detail: hoursDetail(c),
    };
    const push = (status: DcMonthOptionStatus, selectable: boolean, reason?: string) =>
      options.push({ ...base, status, selectable, reason });

    if (active.has(c.workMonthYmd)) {
      let reason: string | undefined;
      if (c.unavailable) reason = c.unavailable.message;
      else if (shortfall === 0 && c.threshold !== null) {
        reason = `Employer hours now meet the plan minimum (${formatDcHours(c.qualifyingHours)} of ${formatDcHours(
          c.threshold,
        )} hours reported) — uncheck it, or it will be voided at approval and no annual month will be consumed.`;
      }
      push("selected", true, reason);
      continue;
    }
    if (c.unavailable || c.coverageMonthYmd === null) {
      const reason = c.unavailable?.noContinuedBenefits
        ? firstWmb
          ? `No coverage to continue as of this work month — the worker's first established coverage month is ${formatYmdMonth(
              firstWmb,
            )}.`
          : "Disability Credit can only extend existing coverage — this worker has no established coverage month."
        : c.unavailable?.message ?? "The plan lag for this month could not be resolved.";
      push("unavailable", false, reason);
      continue;
    }
    if (otherWork.has(c.workMonthYmd) || otherCoverage.has(c.coverageMonthYmd)) {
      push("conflicting", false, "Held by another Disability Credit case for this worker.");
      continue;
    }
    if (wmb.has(c.coverageMonthYmd)) {
      push("covered", false, "Already covered — no Disability Credit needed.");
      continue;
    }
    if (shortfall === 0 && c.threshold !== null) {
      push(
        "not_grantable",
        false,
        `Employer hours already meet the plan minimum (${formatDcHours(c.qualifyingHours)} of ${formatDcHours(
          c.threshold,
        )} hours reported) — no Disability Credit needed.`,
      );
      continue;
    }
    if (firstCovered === null) {
      push(
        "unavailable",
        false,
        "Disability Credit can only extend existing coverage — this worker has no established coverage month.",
      );
      continue;
    }
    if (monthOrdinal(c.coverageMonthYmd) <= firstCovered) {
      push(
        "unavailable",
        false,
        `At or before the worker's first established coverage month (${formatYmdMonth(ordinalToYmd(firstCovered))}).`,
      );
      continue;
    }
    push("available", true);
  }
  return options;
}
