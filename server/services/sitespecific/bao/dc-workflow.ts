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
 */
import { storage } from "../../../storage";
import {
  BAO_DC_ANNUAL_MONTH_LIMIT,
  type BaoDcCase,
  type BaoDcCaseMonth,
  type BaoDcCaseStatus,
} from "@shared/schema";
import {
  computeDcChecklist,
  computeDcMonthOptions,
  type DcChecklistResult,
  type DcMonthOption,
} from "@shared/sitespecific/bao/dc-workflow";
import { getDcDenialLetterValidityMonths } from "./dc-settings";
import { denialLetterExpiryYmd } from "@shared/sitespecific/bao/dc-eligibility";
import { buildDcYearUsage } from "@shared/sitespecific/bao/dc-reporting";
import {
  createDcContinuationContext,
  previewDcGrantConfigWarnings,
  runDcGrantCascadeForCase,
  type DcGrantConfigWarning,
} from "./dc-grant";

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
   * Guided-picker choices: the rolling option window with per-month
   * status/reason so the interface can distinguish selectable, selected,
   * covered, conflicting, and otherwise unavailable months.
   */
  monthOptions: DcMonthOption[];
  /** Per-year usage across ALL of the worker's cases (non-removed months). */
  yearUsage: Record<string, { used: number; limit: number }>;
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

/**
 * Approvers need to see WHO completed the attestations, not just that they
 * exist — resolve the stamped user id to a display name.
 */
async function resolveAttestationAuthor(
  theCase: BaoDcCase,
): Promise<{ id: string; name: string } | null> {
  const attestedById = theCase.attestations?.updatedByUserId;
  if (!attestedById) return null;
  const user = await storage.users.getUser(attestedById);
  const name = user
    ? [user.firstName, user.lastName].filter(Boolean).join(" ").trim() || user.email
    : attestedById;
  return { id: attestedById, name };
}

/**
 * Advisory grant-configuration preview: for OPEN cases, run the exact
 * approval-time configuration check on each still-selected month so
 * approvers see missing/conflicting benefit-rule configuration before
 * clicking Approve. Advisory only — readiness never consults it.
 *
 * Takes the months as a promise so the per-worker inputs the check needs
 * (worker, elections, benefit rows, member-status history) start loading
 * while the month rows are still on their way, instead of after them.
 */
async function previewOpenCaseGrantWarnings(
  theCase: BaoDcCase,
  months: Promise<BaoDcCaseMonth[]>,
): Promise<DcGrantConfigWarning[]> {
  if (!OPEN_STATUSES.includes(theCase.status)) return [];
  const context = createDcContinuationContext(theCase.workerId, { prefetch: true });
  const selected = (await months)
    .filter((m) => m.status === "selected")
    .map((m) => m.workMonthYmd);
  return previewDcGrantConfigWarnings(theCase.workerId, selected, context);
}

export async function getDcCaseBundle(caseId: string): Promise<DcCaseBundle | undefined> {
  const dc = storage.baoDisabilityCredit;
  const theCase = await dc.getCase(caseId);
  if (!theCase) return undefined;
  // Everything below depends on nothing but the case row, so it all runs
  // side by side — the storage reads, the attestation-author lookup and the
  // grant-configuration preview — rather than in sequential phases.
  const monthsPromise = dc.listCaseMonths(caseId);
  const [
    months,
    documents,
    events,
    applicable,
    letters,
    validityMonths,
    covered,
    attestationAuthor,
    grantConfigWarnings,
  ] = await Promise.all([
    monthsPromise,
    dc.listCaseDocumentsWithFiles(caseId),
    dc.listEventsForCase(caseId),
    dc.listApplicableMonthsForWorker(theCase.workerId),
    dc.listNonVoidedDenialLettersForWorker(theCase.workerId),
    getDcDenialLetterValidityMonths(),
    dc.getCoveredMonthsForWorker(theCase.workerId),
    resolveAttestationAuthor(theCase),
    previewOpenCaseGrantWarnings(theCase, monthsPromise),
  ]);
  const readiness = computeCaseReadiness(theCase, documents, months);
  const yearUsage = buildDcYearUsage(applicable);
  const monthOptions = computeDcMonthOptions({
    nowMonthYmd: `${new Date().toISOString().slice(0, 7)}-01`,
    coveredMonths: covered,
    otherCaseMonths: applicable
      .filter((m) => m.caseId !== caseId)
      .map((m) => m.workMonthYmd),
    activeCaseMonths: months
      .filter((m) => m.status !== "removed")
      .map((m) => m.workMonthYmd),
  });
  return {
    case: theCase,
    months,
    monthOptions,
    documents,
    events,
    readiness,
    attestationAuthor,
    yearUsage,
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
  yearUsage: Record<string, { used: number; limit: number }>;
  grantConfigWarnings: DcGrantConfigWarning[];
  events: Awaited<ReturnType<typeof storage.baoDisabilityCredit.listEventsForCase>>;
}

/**
 * Queue-row inputs for an already-loaded case: live readiness, month count,
 * annual usage, the batched grant-configuration preview and the event log
 * (for the queued-at stamp). Reads only what the queue displays — never the
 * documents' file rows, denial letters, covered months or month options the
 * full bundle assembles for the case page — and reads it all side by side.
 */
export async function getDcCaseQueueSummary(theCase: BaoDcCase): Promise<DcCaseQueueSummary> {
  const dc = storage.baoDisabilityCredit;
  const monthsPromise = dc.listCaseMonths(theCase.id);
  const [months, documents, applicable, events, grantConfigWarnings] = await Promise.all([
    monthsPromise,
    dc.listDocumentsForCase(theCase.id),
    dc.listApplicableMonthsForWorker(theCase.workerId),
    dc.listEventsForCase(theCase.id),
    previewOpenCaseGrantWarnings(theCase, monthsPromise),
  ]);
  return {
    readiness: computeCaseReadiness(theCase, documents, months),
    monthCount: months.filter((m) => m.status !== "removed").length,
    yearUsage: buildDcYearUsage(applicable),
    grantConfigWarnings,
    events,
  };
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
  grant?: Awaited<ReturnType<typeof runDcGrantCascadeForCase>>;
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
      const grant = await runDcGrantCascadeForCase(caseId, opts.actorUserId);
      return { case: updated, readiness, grant };
    }
    return { case: updated, readiness };
  });
}
