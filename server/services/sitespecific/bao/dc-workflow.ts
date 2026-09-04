/**
 * Disability Credit case workflow service — orchestrates the storage layer
 * with the shared pure checklist/selection logic.
 *
 * Readiness is COMPUTED, never stored: checklist pass (current documents +
 * staff attestations) plus at least one non-removed month. Whenever evidence
 * changes (upload, supersede, attestation edit), callers run
 * `recomputeReadinessAndMaybeBounce` — an in-queue or ready case whose
 * checklist stops passing is automatically bounced back to draft with the
 * explanation carried on the case_status_changed event payload.
 *
 * Month selection lives on the COVERAGE axis (the Fund approves coverage
 * months; each maps to the work month that receives the credit hours) while
 * the stored/API key stays the work month. Every reasoning path — picker
 * options, the selection validator, and the approve-time re-check — reads
 * the same per-worker month map (dc-month-map.ts), so plan lag and minimum
 * can never disagree between what staff were offered and what gets granted.
 */
import { storage } from "../../../storage";
import { DcSelectionInvalidError } from "../../../storage/sitespecific/bao/disability-credit";
import {
  type BaoDcCase,
  type BaoDcCaseMonth,
  type BaoDcCaseStatus,
} from "@shared/schema";
import {
  computeDcChecklist,
  describeDcMonthRef,
  formatDcHours,
  type DcChecklistResult,
  type DcMonthOption,
  type DcSelectionError,
  type DcSelectionValidation,
} from "@shared/sitespecific/bao/dc-workflow";
import { getDcDenialLetterValidityMonths } from "./dc-settings";
import { denialLetterExpiryYmd } from "@shared/sitespecific/bao/dc-eligibility";
import {
  buildDcYearUsage,
  deriveDcAnnualMaxStatus,
  deriveDcCaseMonthStates,
  deriveDcMonthHistory,
  type DcAnnualMaxStatus,
  type DcCaseMonthState,
  type DcMonthHistoryEntry,
} from "@shared/sitespecific/bao/dc-reporting";
import type { Ymd } from "@shared/utils/date";
import {
  createDcContinuationContext,
  currentMonthYmd,
  DcGrantError,
  previewDcGrantConfigWarnings,
  resolveContinuationRequirement,
  runDcGrantCascadeForCase,
  type DcContinuationContext,
  type DcGrantConfigWarning,
  type GrantOutcome,
} from "./dc-grant";
import {
  buildDcWorkerMonthMap,
  dcMonthOptionsFromMap,
  dcMonthRefsFromMap,
  stampedCoverageMonth,
  validateDcSelectionAgainstMap,
  type DcWorkerMonthMap,
} from "./dc-month-map";

export interface DcCaseReadiness {
  checklist: DcChecklistResult;
  hasMonths: boolean;
  ready: boolean;
  /** Every missing item, by name — months included. */
  missing: string[];
}

export function computeCaseReadiness(
  theCase: BaoDcCase,
  docs: Awaited<ReturnType<typeof storage.baoDisabilityCredit.listDocumentsForCase>>,
  months: BaoDcCaseMonth[],
): DcCaseReadiness {
  const checklist = computeDcChecklist(docs, theCase.attestations);
  const hasMonths = months.some((m) => m.status !== "removed");
  const missing = [...checklist.missing];
  if (!hasMonths) missing.push("At least one selected month");
  return { checklist, hasMonths, ready: missing.length === 0, missing };
}

export interface DcCaseBundle {
  case: BaoDcCase;
  months: BaoDcCaseMonth[];
  documents: Awaited<ReturnType<typeof storage.baoDisabilityCredit.listCaseDocumentsWithFiles>>;
  events: Awaited<ReturnType<typeof storage.baoDisabilityCredit.listEventsForCase>>;
  readiness: DcCaseReadiness;
  /** Display reference for whoever last completed the attestations. */
  attestationAuthor: { id: string; name: string } | null;
  /**
   * Guided-picker choices on the coverage axis: the rolling option window
   * with per-month status/reason so the interface can distinguish
   * selectable, selected, covered, conflicting, not-grantable and otherwise
   * unavailable months. Each option carries BOTH keys; the client submits
   * the work-month key.
   */
  monthOptions: DcMonthOption[];
  /** Per-month state (coverage month, hours, reason) for every case month. */
  monthStates: DcCaseMonthState[];
  /** Chronological grant/queue/release/reconcile/void log for the case. */
  monthHistory: DcMonthHistoryEntry[];
  /** Display names for user ids stamped on events (actors). */
  actorNames: Record<string, string>;
  /** Per-year usage across ALL of the worker's cases (non-removed months). */
  yearUsage: Record<string, { used: number; limit: number }>;
  /** Current-year maxed-out state (same derivation as the dashboard list). */
  annualMax: DcAnnualMaxStatus;
  denialLetters: Array<{
    id: string;
    letterYmd: string;
    voidedYmd: string | null;
    /** Derived end-exclusive expiry under the CURRENT configured validity. */
    expiresYmd: string;
  }>;
  /**
   * ADVISORY grant-configuration preview for open cases: the selected months
   * whose approval-time continuation check (resolveContinuationRequirement)
   * would fail, with the reason. Never affects readiness or queueing.
   */
  grantConfigWarnings: DcGrantConfigWarning[];
}

/** Statuses whose selected months still face the approval-time grant check. */
const OPEN_STATUSES: readonly BaoDcCaseStatus[] = ["draft", "ready_for_review", "in_queue"];

/** Display name for a user id (falls back to the id when unknown). */
async function displayNameForUser(userId: string): Promise<string> {
  const user = await storage.users.getUser(userId);
  return user
    ? [user.firstName, user.lastName].filter(Boolean).join(" ").trim() || user.email || userId
    : userId;
}

/**
 * Approvers need to see WHO completed the attestations, not just that they
 * exist — resolve the stamped user id to a display name.
 */
async function resolveAttestationAuthor(
  theCase: BaoDcCase,
): Promise<{ id: string; name: string } | null> {
  const attestedById = theCase.attestations?.updatedByUserId;
  if (!attestedById) return null;
  return { id: attestedById, name: await displayNameForUser(attestedById) };
}

/**
 * Advisory grant-configuration preview for summary surfaces (the approval
 * queue): for OPEN cases, run the exact approval-time configuration check on
 * each still-selected month so approvers see missing/conflicting
 * benefit-rule configuration before opening the case. Advisory only —
 * readiness never consults it. The case page derives the same warnings
 * from its month map instead (one resolution per month serves both).
 *
 * Takes the months as a promise so the per-worker inputs the check needs
 * (worker, elections, benefit rows, member-status history) start loading
 * while the month rows are still on their way, instead of after them.
 */
async function previewOpenCaseGrantWarnings(
  theCase: BaoDcCase,
  months: Promise<BaoDcCaseMonth[]>,
  context: DcContinuationContext,
): Promise<DcGrantConfigWarning[]> {
  if (!OPEN_STATUSES.includes(theCase.status)) return [];
  const selected = (await months)
    .filter((m) => m.status === "selected")
    .map((m) => m.workMonthYmd);
  return previewDcGrantConfigWarnings(theCase.workerId, selected, context);
}

/** Resolve display names for a set of user ids (one lookup per id). */
export async function resolveActorNames(userIds: Iterable<string>): Promise<Record<string, string>> {
  const ids = Array.from(new Set(Array.from(userIds).filter(Boolean)));
  const names = await Promise.all(ids.map((id) => displayNameForUser(id)));
  return Object.fromEntries(ids.map((id, i) => [id, names[i]]));
}

/** Calendar year of the current work month (usage is counted by work month). */
export function currentDcUsageYear(nowMonthYmd: Ymd = currentMonthYmd()): number {
  return Number(nowMonthYmd.slice(0, 4));
}

export async function getDcCaseBundle(caseId: string): Promise<DcCaseBundle | undefined> {
  const dc = storage.baoDisabilityCredit;
  const theCase = await dc.getCase(caseId);
  if (!theCase) return undefined;
  // Everything below depends on nothing but the case row, so it all runs
  // side by side — the storage reads and the attestation-author lookup —
  // while the month map's per-worker inputs are already prefetching.
  const ctx = createDcContinuationContext(theCase.workerId, { prefetch: true });
  const [months, documents, events, applicable, letters, validityMonths, attestationAuthor] =
    await Promise.all([
      dc.listCaseMonths(caseId),
      dc.listCaseDocumentsWithFiles(caseId),
      dc.listEventsForCase(caseId),
      dc.listApplicableMonthsForWorker(theCase.workerId),
      dc.listNonVoidedDenialLettersForWorker(theCase.workerId),
      getDcDenialLetterValidityMonths(),
      resolveAttestationAuthor(theCase),
    ]);
  const readiness = computeCaseReadiness(theCase, documents, months);

  // ONE month map for the picker, the advisory configuration preview and
  // the per-month state view: the window plus every month of this case
  // (removed ones included, so their coverage month can still be shown).
  const nowMonthYmd = currentMonthYmd();
  const map = await buildDcWorkerMonthMap({
    workerId: theCase.workerId,
    caseId,
    extraWorkMonths: months.map((m) => m.workMonthYmd),
    nowMonthYmd,
    ctx,
    otherCaseRows: applicable.filter((m) => m.caseId !== caseId),
  });
  const activeCaseMonths = months.filter((m) => m.status !== "removed").map((m) => m.workMonthYmd);
  const monthOptions = dcMonthOptionsFromMap(map, activeCaseMonths);

  // Advisory grant-configuration preview: for OPEN cases, surface each
  // still-selected month whose approval-time configuration check
  // (resolveContinuationRequirement, run by the month map) fails, so
  // approvers see missing/conflicting benefit-rule configuration before
  // clicking Approve. Advisory only — readiness above never consults it.
  const grantConfigWarnings: DcGrantConfigWarning[] = OPEN_STATUSES.includes(theCase.status)
    ? months
        .filter((m) => m.status === "selected")
        .flatMap((m) => {
          const error = map.errorsByWorkMonth.get(m.workMonthYmd);
          const option = map.byWorkMonth.get(m.workMonthYmd);
          return error && option?.unavailable
            ? [{ workMonthYmd: m.workMonthYmd, code: error.code, message: option.unavailable.message }]
            : [];
        })
    : [];

  const coverageFor = (workMonthYmd: Ymd) => map.byWorkMonth.get(workMonthYmd)?.coverageMonthYmd ?? null;
  const monthStates = deriveDcCaseMonthStates(months, events, coverageFor);
  const monthHistory = deriveDcMonthHistory(events, months, coverageFor);
  const actorNames = await resolveActorNames(
    monthHistory.map((e) => e.actorUserId).filter((id): id is string => !!id),
  );
  const yearUsage = buildDcYearUsage(applicable);
  return {
    case: theCase,
    months,
    monthOptions,
    monthStates,
    monthHistory,
    actorNames,
    documents,
    events,
    readiness,
    attestationAuthor,
    yearUsage,
    annualMax: deriveDcAnnualMaxStatus(yearUsage, currentDcUsageYear(nowMonthYmd)),
    denialLetters: letters.map((l) => ({
      ...l,
      expiresYmd: denialLetterExpiryYmd(l.letterYmd, validityMonths),
    })),
    grantConfigWarnings,
  };
}

/** The slice of a case the approval queue (and dashboard widget) shows. */
export interface DcCaseQueueSummary {
  readiness: DcCaseReadiness;
  /** Non-removed months on the case. */
  monthCount: number;
  /** Non-removed months on both axes (coverage month primary in the UI). */
  months: Array<{ workMonthYmd: string; coverageMonthYmd: Ymd | null; status: string }>;
  yearUsage: Record<string, { used: number; limit: number }>;
  grantConfigWarnings: DcGrantConfigWarning[];
  events: Awaited<ReturnType<typeof storage.baoDisabilityCredit.listEventsForCase>>;
}

/**
 * Queue-row inputs for an already-loaded case: live readiness, the months
 * with their coverage months, annual usage, the batched
 * grant-configuration preview and the event log (for the queued-at stamp).
 * Reads only what the queue displays — never the documents' file rows,
 * denial letters, covered months or month options the full bundle assembles
 * for the case page — and reads it all side by side over ONE per-worker
 * resolution context (the coverage-month derivation and the preview share
 * every memoized read).
 */
export async function getDcCaseQueueSummary(theCase: BaoDcCase): Promise<DcCaseQueueSummary> {
  const dc = storage.baoDisabilityCredit;
  const context = createDcContinuationContext(theCase.workerId, { prefetch: true });
  const monthsPromise = dc.listCaseMonths(theCase.id);
  const [months, documents, applicable, events, grantConfigWarnings] = await Promise.all([
    monthsPromise,
    dc.listDocumentsForCase(theCase.id),
    dc.listApplicableMonthsForWorker(theCase.workerId),
    dc.listEventsForCase(theCase.id),
    previewOpenCaseGrantWarnings(theCase, monthsPromise, context),
  ]);
  const active = months.filter((m) => m.status !== "removed");
  const coverage = await resolveCoverageMonthsForCaseMonths(active, context);
  return {
    readiness: computeCaseReadiness(theCase, documents, months),
    monthCount: active.length,
    months: active.map((m) => ({
      workMonthYmd: m.workMonthYmd,
      coverageMonthYmd: coverage.get(`${m.workerId}:${m.workMonthYmd}`) ?? null,
      status: m.status,
    })),
    yearUsage: buildDcYearUsage(applicable),
    grantConfigWarnings,
    events,
  };
}

// ---------------------------------------------------------------------------
// Month selection (coverage axis, work-month key)
// ---------------------------------------------------------------------------

/**
 * Coverage months for a set of case months (any case, any status): the
 * stamped coverage month first, else a fresh derivation over a shared
 * per-worker resolution context; unresolvable months map to null. Used by
 * summary surfaces (worker tab, member panel, queue) that label months as
 * coverage months without building a whole picker window. Months may span
 * workers; a context is created per worker unless the caller passes one
 * (which must then belong to the months' single worker).
 */
export async function resolveCoverageMonthsForCaseMonths(
  months: Array<Pick<BaoDcCaseMonth, "workerId" | "workMonthYmd" | "data">>,
  ctx?: DcContinuationContext,
): Promise<Map<string, Ymd | null>> {
  const result = new Map<string, Ymd | null>();
  const contexts = new Map<string, DcContinuationContext>();
  if (ctx) contexts.set(ctx.workerId, ctx);
  const contextFor = (workerId: string): DcContinuationContext => {
    let c = contexts.get(workerId);
    if (!c) {
      c = createDcContinuationContext(workerId);
      contexts.set(workerId, c);
    }
    return c;
  };
  for (const m of months) {
    const key = `${m.workerId}:${m.workMonthYmd}`;
    if (result.has(key)) continue;
    const stamped = stampedCoverageMonth(m);
    if (stamped) {
      result.set(key, stamped);
      continue;
    }
    try {
      const requirement = await resolveContinuationRequirement(
        m.workerId,
        m.workMonthYmd,
        contextFor(m.workerId),
      );
      result.set(key, requirement.coverageMonthYmd);
    } catch (error) {
      if (!(error instanceof DcGrantError)) throw error;
      result.set(key, null);
    }
  }
  return result;
}

/**
 * Read-only validation preview of a proposed FULL work-month set for a
 * draft case, on the coverage axis (same map, same validator as the save).
 */
export async function validateDcCaseMonthSelection(
  caseId: string,
  workMonthYmds: string[],
): Promise<DcSelectionValidation> {
  const dc = storage.baoDisabilityCredit;
  const theCase = await dc.getCase(caseId);
  if (!theCase) throw new Error("CASE_NOT_FOUND");
  const target = Array.from(new Set(workMonthYmds)).sort();
  const map = await buildDcWorkerMonthMap({
    workerId: theCase.workerId,
    caseId,
    extraWorkMonths: target,
  });
  return validateDcSelectionAgainstMap(map, target);
}

/**
 * FULL-SET month replace for a draft case. The coverage-axis validation runs
 * INSIDE storage's transaction, after the case row and worker lock are held
 * (other-case rows, WMB and hours are read tx-consistently), so concurrent
 * cases cannot over-allocate a worker/month or a year.
 */
export async function replaceDcCaseMonths(
  caseId: string,
  workMonthYmds: string[],
  opts: { actorUserId: string; removalReason?: string },
): Promise<BaoDcCaseMonth[]> {
  return storage.baoDisabilityCredit.replaceCaseMonths(caseId, workMonthYmds, {
    ...opts,
    validate: async (theCase, target, active) => {
      // Active months are enumerated too: a deselected month's void event
      // records the coverage month it stood for, not a later derivation.
      const touched = Array.from(new Set([...target, ...active]));
      const map = await buildDcWorkerMonthMap({
        workerId: theCase.workerId,
        caseId: theCase.id,
        extraWorkMonths: touched,
      });
      const validation = validateDcSelectionAgainstMap(map, target);
      if (!validation.ok) throw new DcSelectionInvalidError(validation);
      return {
        coverageByWorkMonth: new Map(
          touched.map((ymd) => [ymd, map.byWorkMonth.get(ymd)?.coverageMonthYmd ?? null]),
        ),
      };
    },
  });
}

/** A selected month found to need no credit at approval time. */
export interface DcApprovalWarning {
  kind: "no_shortfall";
  caseId: string;
  workMonthYmd: string;
  coverageMonthYmd: string;
  qualifyingHours: number;
  threshold: number;
  message: string;
}

function noShortfallWarning(outcome: GrantOutcome): DcApprovalWarning {
  const ref = { workMonthYmd: outcome.workMonthYmd, coverageMonthYmd: outcome.coverageMonthYmd };
  const qualifyingHours = outcome.qualifyingHours ?? 0;
  const threshold = outcome.threshold ?? 0;
  return {
    kind: "no_shortfall",
    caseId: outcome.caseId,
    workMonthYmd: outcome.workMonthYmd,
    coverageMonthYmd: outcome.coverageMonthYmd,
    qualifyingHours,
    threshold,
    message: `${describeDcMonthRef(ref)} was not credited: ${formatDcHours(qualifyingHours)} qualifying hours already meet the ${formatDcHours(threshold)}-hour minimum. No annual month was consumed and the month was removed from the case.`,
  };
}

/**
 * Approve-time re-validation over the SAME month map the cascade will use:
 * months that no longer have a shortfall are left to the cascade (which
 * voids them without consuming an annual month) and the rest must still fit
 * the year and keep coverage continuous. Only capacity and continuity block;
 * unresolvable months throw the resolver's own error (case left unchanged).
 */
export function checkDcApprovalSelection(
  map: DcWorkerMonthMap,
  caseMonths: BaoDcCaseMonth[],
): { blocking: DcSelectionError[]; validation: DcSelectionValidation } {
  const selected = caseMonths.filter((m) => m.status === "selected");
  const { unresolvable } = dcMonthRefsFromMap(
    map,
    selected.map((m) => m.workMonthYmd),
  );
  if (unresolvable.length > 0) {
    const error = map.errorsByWorkMonth.get(unresolvable[0]);
    if (error) throw error;
  }
  const needsCredit = selected.filter((m) => {
    const c = map.byWorkMonth.get(m.workMonthYmd);
    return !!c && c.threshold !== null && c.qualifyingHours < c.threshold;
  });
  // Months of THIS case already queued/granted (approval retry) are committed
  // anchors, exactly like other cases' months.
  const committed = caseMonths
    .filter((m) => m.status === "queued" || m.status === "granted")
    .map((m) => ({
      workMonthYmd: m.workMonthYmd,
      coverageMonthYmd:
        stampedCoverageMonth(m) ?? map.byWorkMonth.get(m.workMonthYmd)?.coverageMonthYmd ?? null,
    }));
  const validation = validateDcSelectionAgainstMap(
    { ...map, otherCaseMonths: [...map.otherCaseMonths, ...committed] },
    needsCredit.map((m) => m.workMonthYmd),
  );
  const blocking = validation.errors.filter(
    (e) => e.code === "CAPACITY_EXCEEDED" || e.code === "CONTINUITY_GAP",
  );
  return { blocking, validation };
}

/**
 * Recompute readiness after an evidence change; auto-bounce a
 * ready_for_review or in_queue case back to draft when the checklist no
 * longer passes; the reason (naming what went missing) rides the
 * case_status_changed event payload.
 */
export async function recomputeReadinessAndMaybeBounce(
  caseId: string,
  actorUserId: string,
): Promise<{ readiness: DcCaseReadiness; bounced: boolean }> {
  const dc = storage.baoDisabilityCredit;
  // Serialized on the case's worker: the readiness read, the bounce decision
  // and the transition commit atomically (nested storage calls join the tx).
  return dc.withCaseSerialization(caseId, async () => {
    const theCase = await dc.getCase(caseId);
    if (!theCase) throw new Error("CASE_NOT_FOUND");
    const [docs, months] = await Promise.all([
      dc.listDocumentsForCase(caseId),
      dc.listCaseMonths(caseId),
    ]);
    const readiness = computeCaseReadiness(theCase, docs, months);
    const bounceable: BaoDcCaseStatus[] = ["ready_for_review", "in_queue"];
    if (readiness.ready || !bounceable.includes(theCase.status)) {
      return { readiness, bounced: false };
    }
    await dc.transitionCase(caseId, {
      to: "draft",
      actorUserId,
      expectedStatus: theCase.status,
      reason: `Automatically returned to draft — readiness no longer passes. Missing: ${readiness.missing.join("; ")}.`,
    });
    return { readiness, bounced: true };
  });
}

/**
 * Atomically apply a readiness-affecting evidence mutation (supersede,
 * reclassify/rename, attestation change) and the recompute/auto-bounce that
 * must follow it — all in ONE transaction under the case's serialization
 * lock, so the mutation can never commit without its bounce, and can never
 * interleave with an in-flight approval's readiness recheck.
 */
export async function mutateEvidenceAndRecompute<T>(
  caseId: string,
  actorUserId: string,
  mutate: () => Promise<T>,
): Promise<{ result: T; readiness: DcCaseReadiness; bounced: boolean }> {
  const dc = storage.baoDisabilityCredit;
  return dc.withCaseSerialization(caseId, async () => {
    const result = await mutate();
    const { readiness, bounced } = await recomputeReadinessAndMaybeBounce(caseId, actorUserId);
    return { result, readiness, bounced };
  });
}

/**
 * Oldest-first next open queued case, excluding the given case(s). Used for
 * "go to next case" continuation after an MSR/approver finishes one — an
 * empty (or concurrently drained) queue resolves to null cleanly.
 */
export async function getNextQueuedDcCaseId(
  excludeCaseIds: string[] = [],
): Promise<string | null> {
  const queued = await storage.baoDisabilityCredit.listCasesByStatus("in_queue");
  const next = queued.find((c) => !excludeCaseIds.includes(c.id));
  return next?.id ?? null;
}

export type DcCaseAction =
  | "send_for_approval"
  | "bounce"
  | "approve"
  | "deny"
  | "withdraw";

const ACTION_TARGET: Record<DcCaseAction, BaoDcCaseStatus> = {
  // The ONE preparation handoff: draft (or legacy ready_for_review) →
  // in_queue. Readiness and month selection are validated below.
  send_for_approval: "in_queue",
  bounce: "draft",
  approve: "approved",
  deny: "denied",
  withdraw: "withdrawn",
};

/**
 * Perform a staff/approver action. send_for_approval and approve re-check
 * readiness IMMEDIATELY before transitioning so stale screens cannot push a
 * no-longer-ready case forward (Error("CASE_NOT_READY") names the missing
 * items via `details`).
 */
export async function performDcCaseAction(
  caseId: string,
  action: DcCaseAction,
  opts: {
    actorUserId: string;
    reason?: string;
    expectedStatus?: BaoDcCaseStatus;
    /**
     * Status-dependent authorization, run INSIDE the case serialization
     * lock on the freshly-loaded case — the status it sees is the status
     * the transition will act on, so a concurrent transition cannot open a
     * check-then-act gap (e.g. a non-approver bouncing a case that became
     * queued between an outside read and the lock). Throw to refuse.
     */
    authorize?: (theCase: BaoDcCase) => Promise<void>;
  },
): Promise<{
  case: BaoDcCase;
  readiness: DcCaseReadiness;
  /** Present on approve: per-month grant/queue/remove outcomes. */
  grant?: GrantOutcome[];
  /** Present on approve: months voided because they no longer had a shortfall. */
  warnings?: DcApprovalWarning[];
}> {
  const dc = storage.baoDisabilityCredit;
  // Serialized on the case's worker: readiness is computed while HOLDING the
  // lock, immediately before the transition, in the same transaction — a
  // concurrent supersede/reclassify either commits first (and this recheck
  // sees it) or waits until this action commits.
  return dc.withCaseSerialization(caseId, async () => {
    const theCase = await dc.getCase(caseId);
    if (!theCase) throw new Error("CASE_NOT_FOUND");
    const [docs, months] = await Promise.all([
      dc.listDocumentsForCase(caseId),
      dc.listCaseMonths(caseId),
    ]);
    if (opts.authorize) await opts.authorize(theCase);
    const readiness = computeCaseReadiness(theCase, docs, months);

    if (["send_for_approval", "approve"].includes(action) && !readiness.ready) {
      const err = new Error("CASE_NOT_READY") as Error & { details?: string[] };
      err.details = readiness.missing;
      throw err;
    }

    // Approve-time re-validation on the coverage axis, BEFORE the
    // transition, under the same lock and in the same transaction the
    // cascade runs in: a selection that would now exceed the annual
    // capacity or leave a coverage gap blocks with named reasons; the
    // month map (and its resolution context) is reused by the cascade so
    // both see one lag/minimum per month.
    let ctx: DcContinuationContext | undefined;
    if (action === "approve") {
      const map = await buildDcWorkerMonthMap({
        workerId: theCase.workerId,
        caseId,
        extraWorkMonths: months.map((m) => m.workMonthYmd),
      });
      ctx = map.ctx;
      const { blocking, validation } = checkDcApprovalSelection(map, months);
      if (blocking.length > 0) {
        throw new DcSelectionInvalidError({ ...validation, ok: false, errors: blocking });
      }
    }

    const updated = await dc.transitionCase(caseId, {
      to: ACTION_TARGET[action],
      actorUserId: opts.actorUserId,
      // Bounce (and terminal) reasons ride the case_status_changed payload.
      reason: opts.reason,
      expectedStatus: opts.expectedStatus,
    });
    if (action === "approve") {
      // Grant cascade — same transaction and worker lock as the transition,
      // so approval and its hours writes commit (or fail) atomically. Runs
      // on every approve call, so a retry after a partial failure resumes
      // the remaining `selected` months (already-granted ones are skipped).
      const grant = await runDcGrantCascadeForCase(caseId, opts.actorUserId, ctx);
      const warnings = grant
        .filter((o) => o.action === "removed" && o.reason === "no_shortfall")
        .map(noShortfallWarning);
      return { case: updated, readiness, grant, warnings };
    }
    return { case: updated, readiness };
  });
}
