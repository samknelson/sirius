/**
 * Disability Credit month map — the ONE per-worker derivation of the
 * coverage axis that the guided picker, the selection validator and the
 * approve-time re-validation all read from.
 *
 * For every candidate WORK month (the picker window plus whatever must be
 * shown regardless: this case's active months, months held by other cases,
 * a proposed selection) it derives, with the grant service's OWN requirement
 * resolver behind one shared request context:
 *
 *   coverage month  = work month + the plan lag of the benefits continued
 *   plan minimum    = the continuation threshold for that work month
 *   qualifying hrs  = employed/FMLA hours already reported (Fund/DC excluded)
 *   shortfall       = max(0, minimum − qualifying)          (never stored)
 *
 * Resolver CONFIGURATION failures (no policy, no threshold rule, conflicting
 * thresholds) become per-month "unavailable" reasons instead of errors, so a
 * mis-configured month cannot take the whole picker down. Anything else
 * propagates — a broken read must fail the request, never render a lie.
 *
 * The covered set on the coverage axis is WMB months ∪ the coverage months of
 * work months already at the minimum. Storage never sees any of this: it
 * only offers the raw WMB months and the bulk qualifying-hours read.
 */
import { storage } from "../../../storage/database";
import {
  BAO_DC_FUND_EMPLOYER_SIRIUS_ID,
  type BaoDcCaseMonth,
} from "@shared/schema";
import {
  computeDcMonthOptions,
  deriveDcCoveredCoverageMonths,
  enumerateDcCandidateWorkMonths,
  validateDcMonthSelection,
  type DcMonthCandidate,
  type DcMonthOption,
  type DcMonthRef,
  type DcOtherCaseMonth,
  type DcSelectionValidation,
} from "@shared/sitespecific/bao/dc-workflow";
import type { Ymd } from "@shared/utils/date";
import {
  createDcContinuationContext,
  currentMonthYmd,
  DC_GRANT_ERROR_DESCRIPTIONS,
  DcGrantError,
  primeDcFundEmployerCache,
  resolveContinuationRequirement,
  type DcContinuationContext,
} from "./dc-grant";

const FIRST_OF_MONTH = /^\d{4}-\d{2}-01$/;

export interface DcWorkerMonthMap {
  workerId: string;
  nowMonthYmd: Ymd;
  /** Every enumerated work month, sorted, with its derived coverage data. */
  candidates: DcMonthCandidate[];
  byWorkMonth: Map<Ymd, DcMonthCandidate>;
  /** The resolver's coded error for each unresolvable work month. */
  errorsByWorkMonth: Map<Ymd, DcGrantError>;
  /** Coverage months WMB shows as covered. */
  wmbCoverageMonths: Ymd[];
  /** WMB ∪ at-minimum coverage months — the validator's covered set. */
  coveredCoverageMonths: Ymd[];
  /** Non-removed months on the worker's OTHER cases, on both axes. */
  otherCaseMonths: DcOtherCaseMonth[];
  /** The shared resolution context (reuse it for the grant cascade). */
  ctx: DcContinuationContext;
}

export interface BuildDcWorkerMonthMapOptions {
  workerId: string;
  /** The case being viewed/edited — its months are NOT "other case" months. */
  caseId?: string;
  /** Extra work months to enumerate (active months, a proposed selection). */
  extraWorkMonths?: Ymd[];
  nowMonthYmd?: Ymd;
  /** A context for THIS worker; a fresh prefetching one is created otherwise. */
  ctx?: DcContinuationContext;
  /**
   * Other-case rows when the caller already holds tx-consistent rows;
   * otherwise read via storage (inside the caller's transaction when any).
   */
  otherCaseRows?: BaoDcCaseMonth[];
}

/** Stamped coverage month from a queued/granted month's data, when present. */
export function stampedCoverageMonth(month: Pick<BaoDcCaseMonth, "data">): Ymd | null {
  const data = month.data as { coverageMonthYmd?: unknown } | null;
  const v = data?.coverageMonthYmd;
  return typeof v === "string" && FIRST_OF_MONTH.test(v) ? v : null;
}

async function dcFundEmployerId(): Promise<string | null> {
  const fund = await storage.employers.getBySiriusId(BAO_DC_FUND_EMPLOYER_SIRIUS_ID);
  if (!fund) return null;
  primeDcFundEmployerCache(fund.id);
  return fund.id;
}

/**
 * Build the month map for a worker. Resolution runs sequentially per month
 * (the shared context makes repeats cheap, and the map may be built inside
 * a transaction whose single connection must not see interleaved queries).
 */
export async function buildDcWorkerMonthMap(
  opts: BuildDcWorkerMonthMapOptions,
): Promise<DcWorkerMonthMap> {
  const dc = storage.baoDisabilityCredit;
  if (opts.ctx && opts.ctx.workerId !== opts.workerId) {
    throw new Error(
      `DC month map context is for worker ${opts.ctx.workerId}, not ${opts.workerId}`,
    );
  }
  const ctx = opts.ctx ?? createDcContinuationContext(opts.workerId, { prefetch: true });
  const nowMonthYmd = opts.nowMonthYmd ?? currentMonthYmd();

  const otherRows =
    opts.otherCaseRows ?? (await dc.listApplicableMonthsForWorker(opts.workerId, opts.caseId));
  const workMonths = enumerateDcCandidateWorkMonths(nowMonthYmd, [
    ...(opts.extraWorkMonths ?? []),
    ...otherRows.map((m) => m.workMonthYmd),
  ]);

  const excludeEmployerId = await dcFundEmployerId();
  const [wmbCoverageMonths, hoursByMonth] = await Promise.all([
    dc.getWmbMonthsForWorker(opts.workerId),
    dc.listQualifyingHoursByMonthForWorker(opts.workerId, excludeEmployerId),
  ]);

  const candidates: DcMonthCandidate[] = [];
  const errorsByWorkMonth = new Map<Ymd, DcGrantError>();
  for (const workMonthYmd of workMonths) {
    const qualifyingHours = hoursByMonth.get(workMonthYmd) ?? 0;
    try {
      const requirement = await resolveContinuationRequirement(opts.workerId, workMonthYmd, ctx);
      candidates.push({
        workMonthYmd,
        coverageMonthYmd: requirement.coverageMonthYmd,
        threshold: requirement.threshold,
        qualifyingHours,
      });
    } catch (error) {
      if (!(error instanceof DcGrantError)) throw error;
      errorsByWorkMonth.set(workMonthYmd, error);
      candidates.push({
        workMonthYmd,
        coverageMonthYmd: null,
        threshold: null,
        qualifyingHours,
        unavailable: {
          code: error.code,
          message: DC_GRANT_ERROR_DESCRIPTIONS[error.code],
          noContinuedBenefits:
            (error.details as { reason?: unknown } | undefined)?.reason === "no_continued_benefits",
        },
      });
    }
  }
  const byWorkMonth = new Map(candidates.map((c) => [c.workMonthYmd, c]));

  // Other cases' months: a stamped coverage month (queued/granted rows carry
  // the lag they were granted with) beats a fresh derivation.
  const otherCaseMonths: DcOtherCaseMonth[] = otherRows.map((m) => ({
    workMonthYmd: m.workMonthYmd,
    coverageMonthYmd:
      stampedCoverageMonth(m) ?? byWorkMonth.get(m.workMonthYmd)?.coverageMonthYmd ?? null,
  }));

  return {
    workerId: opts.workerId,
    nowMonthYmd,
    candidates,
    byWorkMonth,
    errorsByWorkMonth,
    wmbCoverageMonths,
    coveredCoverageMonths: deriveDcCoveredCoverageMonths(wmbCoverageMonths, candidates),
    otherCaseMonths,
    ctx,
  };
}

/** Picker options for a case over its month map. */
export function dcMonthOptionsFromMap(map: DcWorkerMonthMap, activeCaseMonths: Ymd[]): DcMonthOption[] {
  return computeDcMonthOptions({
    candidates: map.candidates,
    wmbCoverageMonths: map.wmbCoverageMonths,
    otherCaseMonths: map.otherCaseMonths,
    activeCaseMonths,
  });
}

/**
 * Split a proposed work-month set into resolvable refs (both axes) and the
 * work months whose lag could not be resolved. Months missing from the map
 * count as unresolvable — callers must enumerate the target when building.
 */
export function dcMonthRefsFromMap(
  map: DcWorkerMonthMap,
  workMonthYmds: Ymd[],
): { refs: DcMonthRef[]; unresolvable: Ymd[] } {
  const refs: DcMonthRef[] = [];
  const unresolvable: Ymd[] = [];
  for (const workMonthYmd of workMonthYmds) {
    const c = map.byWorkMonth.get(workMonthYmd);
    if (c && c.coverageMonthYmd !== null) {
      refs.push({ workMonthYmd, coverageMonthYmd: c.coverageMonthYmd });
    } else {
      unresolvable.push(workMonthYmd);
    }
  }
  return { refs, unresolvable };
}

/**
 * Validate a proposed FULL work-month set for a case against its month map.
 * Unresolvable months are reported as a named UNRESOLVABLE_MONTH error (the
 * rest of the selection is still validated so the preview stays complete).
 */
export function validateDcSelectionAgainstMap(
  map: DcWorkerMonthMap,
  workMonthYmds: Ymd[],
): DcSelectionValidation {
  const target = Array.from(new Set(workMonthYmds)).sort();
  const { refs, unresolvable } = dcMonthRefsFromMap(map, target);
  const validation = validateDcMonthSelection({
    selectedMonths: refs,
    otherCaseMonths: map.otherCaseMonths,
    coveredMonths: map.coveredCoverageMonths,
    candidateMonths: map.candidates,
  });
  if (unresolvable.length === 0) return validation;

  const errors: DcSelectionValidation["errors"] = [
    {
      code: "UNRESOLVABLE_MONTH" as const,
      message: `The plan lag or minimum could not be resolved for: ${unresolvable
        .map((w) => {
          const reason = map.byWorkMonth.get(w)?.unavailable?.message ?? "month is outside the picker";
          return `work month ${w.slice(0, 7)} (${reason})`;
        })
        .join("; ")}`,
      months: unresolvable,
      workMonths: unresolvable,
    },
    // An empty resolvable subset is not "no selection" — drop that artefact.
    ...validation.errors.filter((e) => !(refs.length === 0 && e.code === "EMPTY_SELECTION")),
  ];
  // A worker with no established coverage month cannot resolve ANY work
  // month (there is no benefit to continue), so the pure validator never
  // sees a ref to raise its rule on — state the underlying reason too.
  if (
    map.wmbCoverageMonths.length === 0 &&
    !errors.some((e) => e.code === "NO_PRIOR_COVERAGE")
  ) {
    errors.push({
      code: "NO_PRIOR_COVERAGE",
      message:
        "Disability Credit can only extend existing coverage — this worker has no established coverage month.",
    });
  }
  return { ...validation, ok: false, errors };
}
