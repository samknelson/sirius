/**
 * Disability Credit case workflow service — orchestrates the storage layer
 * with the shared pure checklist/selection logic.
 *
 * Readiness is COMPUTED, never stored: checklist pass (current documents +
 * staff attestations) plus at least one non-removed month. Whenever evidence
 * changes (upload, supersede, attestation edit), callers run
 * `recomputeReadinessAndMaybeBounce` — an in-queue or ready case whose
 * checklist stops passing is automatically bounced back to draft with an
 * explanatory system note.
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
  type DcChecklistResult,
} from "@shared/sitespecific/bao/dc-workflow";
import { getDcDenialLetterValidityMonths } from "./dc-settings";
import { denialLetterExpiryYmd } from "@shared/sitespecific/bao/dc-eligibility";
import { runDcGrantCascadeForCase } from "./dc-grant";

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
  notes: Awaited<ReturnType<typeof storage.baoDisabilityCredit.listCaseNotes>>;
  events: Awaited<ReturnType<typeof storage.baoDisabilityCredit.listEventsForCase>>;
  readiness: DcCaseReadiness;
  /** Per-year usage across ALL of the worker's cases (non-removed months). */
  yearUsage: Record<string, { used: number; limit: number }>;
  denialLetters: Array<{
    id: string;
    letterYmd: string;
    voidedYmd: string | null;
    /** Derived end-exclusive expiry under the CURRENT configured validity. */
    expiresYmd: string;
  }>;
}

export async function getDcCaseBundle(caseId: string): Promise<DcCaseBundle | undefined> {
  const dc = storage.baoDisabilityCredit;
  const theCase = await dc.getCase(caseId);
  if (!theCase) return undefined;
  const [months, documents, notes, events, applicable, letters, validityMonths] =
    await Promise.all([
      dc.listCaseMonths(caseId),
      dc.listCaseDocumentsWithFiles(caseId),
      dc.listCaseNotes(caseId),
      dc.listEventsForCase(caseId),
      dc.listApplicableMonthsForWorker(theCase.workerId),
      dc.listNonVoidedDenialLettersForWorker(theCase.workerId),
      getDcDenialLetterValidityMonths(),
    ]);
  const readiness = computeCaseReadiness(theCase, documents, months);
  const yearUsage: Record<string, { used: number; limit: number }> = {};
  for (const m of applicable) {
    const year = m.workMonthYmd.slice(0, 4);
    yearUsage[year] = yearUsage[year] ?? { used: 0, limit: BAO_DC_ANNUAL_MONTH_LIMIT };
    yearUsage[year].used += 1;
  }
  return {
    case: theCase,
    months,
    documents,
    notes,
    events,
    readiness,
    yearUsage,
    denialLetters: letters.map((l) => ({
      ...l,
      expiresYmd: denialLetterExpiryYmd(l.letterYmd, validityMonths),
    })),
  };
}

/**
 * Recompute readiness after an evidence change; auto-bounce a
 * ready_for_review or in_queue case back to draft when the checklist no
 * longer passes, recording a system note naming what went missing.
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
    });
    await dc.addCaseNote({
      caseId,
      authorUserId: actorUserId,
      body: `Automatically returned to draft — readiness no longer passes. Missing: ${readiness.missing.join("; ")}.`,
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

export type DcCaseAction =
  | "mark_ready"
  | "queue"
  | "bounce"
  | "approve"
  | "deny"
  | "withdraw";

const ACTION_TARGET: Record<DcCaseAction, BaoDcCaseStatus> = {
  mark_ready: "ready_for_review",
  queue: "in_queue",
  bounce: "draft",
  approve: "approved",
  deny: "denied",
  withdraw: "withdrawn",
};

/**
 * Perform a staff/approver action. mark_ready, queue and approve re-check
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
    const readiness = computeCaseReadiness(theCase, docs, months);

    if (["mark_ready", "queue", "approve"].includes(action) && !readiness.ready) {
      const err = new Error("CASE_NOT_READY") as Error & { details?: string[] };
      err.details = readiness.missing;
      throw err;
    }

    const updated = await dc.transitionCase(caseId, {
      to: ACTION_TARGET[action],
      actorUserId: opts.actorUserId,
      reason: opts.reason,
      expectedStatus: opts.expectedStatus,
    });
    if (action === "bounce" && opts.reason?.trim()) {
      await dc.addCaseNote({
        caseId,
        authorUserId: opts.actorUserId,
        body: `Returned to draft: ${opts.reason.trim()}`,
      });
    }
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
