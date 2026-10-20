import { storage } from "../storage/database";
import { runInTransaction, runOutsideTransaction } from "../storage/transaction-context";
import { createUnifiedOptionsStorage } from "../storage/unified-options";
import { decideCobraLifecycle, type CobraLifecycleDecision } from "@shared/schema/sitespecific/bao/cobra-lifecycle";
import { evaluateCobraCasePayment, resolveCobraAccountId, todayYmdLocal } from "../modules/sitespecific/bao/cobra-payment-state";
import { eventBus, EventType } from "./event-bus";
import { isCacheInitialized, isComponentEnabledSync } from "./component-cache";
import { logger } from "../logger";
import type { InsertBaoCobraCase } from "@shared/schema/sitespecific/bao/schema";

export interface CobraReconciliationResult {
  caseId: string;
  before?: { statusId: string; paymentStatus: string | null };
  changes: Partial<Pick<InsertBaoCobraCase, "statusId" | "paymentStatus">>;
  blockers: string[];
  applied: boolean;
  initialSatisfied?: boolean;
  targetStatusName?: string;
}

/** Every decision is made from a fresh row under FOR UPDATE. Staff UPDATEs
 * serialize on the same row: a prior closure is seen, a later closure wins.
 * The normal wrapped storage update retains audit history and after-commit
 * coverage invalidation. Dry runs use exactly the same decision path.
 */
export async function reconcileCobraCaseStatus(
  caseId: string,
  options: { mode?: "test" | "live"; todayYmd?: string } = {},
): Promise<CobraReconciliationResult> {
  return runInTransaction(async () => {
    const result: CobraReconciliationResult = { caseId, changes: {}, blockers: [], applied: false };
    const theCase = await storage.baoCobraCases.getForUpdate(caseId);
    if (!theCase) return { ...result, blockers: ["Case no longer exists"] };
    result.before = { statusId: theCase.statusId, paymentStatus: theCase.paymentStatus };
    const statuses: Array<{ id: string; name: string; closed: boolean }> =
      await createUnifiedOptionsStorage().list("bao-cobra-status");
    const current = statuses.find((s) => s.id === theCase.statusId);
    if (!current) return { ...result, blockers: ["Current COBRA status is missing"] };
    if (current.closed) return result; // Closed always wins, even over bad config.
    const todayYmd = options.todayYmd ?? todayYmdLocal();
    let decision: CobraLifecycleDecision;
    if ((theCase.maxPeriodYmd && todayYmd > theCase.maxPeriodYmd) || !theCase.electionMadeYmd) {
      decision = decideCobraLifecycle({
        electedYmd: theCase.electionMadeYmd,
        effectiveYmd: theCase.cobraEffectiveYmd,
        initialDeadlineYmd: theCase.initialPaymentDeadlineYmd,
        maxPeriodYmd: theCase.maxPeriodYmd,
        currentClosed: false,
        todayYmd,
        restoredBenefits: !theCase.electionMadeYmd &&
          await storage.baoCobraCases.hasActiveMedicalOrDentalBenefits(theCase.coveredPersonWorkerId),
        months: [],
      });
    } else {
      let accountId: string | null;
      try {
        accountId = await resolveCobraAccountId();
      } catch (error) {
        return { ...result, blockers: [error instanceof Error ? error.message : String(error)] };
      }
      if (!accountId) return { ...result, blockers: ["No COBRA billing account configured"] };
      // Two overlapping cases could consume the same month allocations.
      const siblings = await storage.baoCobraCases.listElectedActiveCasesForCoveredPerson(theCase.coveredPersonWorkerId);
      if (siblings.some((c) => c.id !== caseId &&
        c.cobraEffectiveYmd <= (theCase.maxPeriodYmd ?? "9999-12-31") &&
        (c.maxPeriodYmd ?? "9999-12-31") >= theCase.cobraEffectiveYmd)) {
        return { ...result, blockers: ["Overlapping elected cases make payment attribution ambiguous"] };
      }
      decision = await evaluateCobraCasePayment(theCase, todayYmd, accountId);
    }
    result.blockers = decision.blockers;
    result.initialSatisfied = decision.initialSatisfied;
    if (result.blockers.length) return result;
    if (decision.status) {
      result.targetStatusName = decision.status;
      const targets = statuses.filter((s) => s.name.trim().toLowerCase() === decision.status!.toLowerCase());
      if (targets.length !== 1 || targets[0].closed !== (decision.status === "Closed")) {
        return { ...result, blockers: [`Missing or ambiguous lifecycle status "${decision.status}" (including closed flag)`] };
      }
      if (targets[0].id !== theCase.statusId) result.changes.statusId = targets[0].id;
    }
    if (decision.paymentStatus !== undefined && decision.paymentStatus !== theCase.paymentStatus) {
      result.changes.paymentStatus = decision.paymentStatus;
    }
    if (options.mode === "live" && Object.keys(result.changes).length) {
      await storage.baoCobraCases.update(caseId, result.changes);
      result.applied = true;
    }
    return result;
  });
}

export async function reconcileCobraWorkerStatuses(workerId: string, accountId?: string): Promise<void> {
  if (!isCacheInitialized() || !isComponentEnabledSync("sitespecific.bao")) return;
  const cases = await storage.baoCobraCases.search({ workerId });
  const affected = cases.filter((c) => c.coveredPersonWorkerId === workerId && !c.statusClosed);
  if (!affected.length) return;
  if (accountId) {
    try {
      const configured = await resolveCobraAccountId();
      if (configured && accountId !== configured) return;
      // Missing configuration must reach the per-case diagnostic below;
      // silently skipping it would hide the reason no transition occurred.
    } catch (error) {
      logger.error("COBRA lifecycle account resolution failed", {
        service: "bao-cobra-lifecycle", workerId,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }
  }
  for (const theCase of affected) {
    try {
      const result = await reconcileCobraCaseStatus(theCase.id, { mode: "live" });
      if (result.blockers.length) logger.error("COBRA lifecycle reconciliation blocked", {
        service: "bao-cobra-lifecycle", caseId: theCase.id, blockers: result.blockers,
      });
    } catch (error) {
      logger.error("COBRA lifecycle reconciliation failed", {
        service: "bao-cobra-lifecycle", caseId: theCase.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/** Bounded keyset recovery; no financial mutations, no schedule changes.
 * A failing case cannot prevent other cases from being inspected.
 */
export async function scanCobraCaseStatuses(mode: "test" | "live", limit = 5000) {
  const results: CobraReconciliationResult[] = [];
  let afterId: string | undefined;
  while (results.length < limit) {
    const cases = await storage.baoCobraCases.listLifecycleCandidates(afterId, Math.min(100, limit - results.length));
    if (!cases.length) return { results, truncated: false };
    for (const theCase of cases) {
      try {
        results.push(await reconcileCobraCaseStatus(theCase.id, { mode }));
      } catch (error) {
        results.push({ caseId: theCase.id, changes: {}, applied: false,
          blockers: [error instanceof Error ? error.message : String(error)] });
      }
    }
    afterId = cases[cases.length - 1].id;
  }
  const remaining = await storage.baoCobraCases.listLifecycleCandidates(afterId, 1);
  return { results, truncated: remaining.length > 0 };
}

let initialized = false;
export function initBaoCobraLifecycle(): void {
  if (initialized) return;
  initialized = true;
  // Storage emits ONLY committed worker-ledger changes, including old/new
  // coordinates on moves. Do not subscribe to PAYMENT_SAVED (pre-allocation).
  eventBus.on({
    name: "bao-cobra-lifecycle-ledger",
    description: "Reconciles COBRA case status after committed worker ledger changes.",
    event: EventType.LEDGER_ENTRY_SAVED,
    handler: (payload) => runOutsideTransaction(async () => {
      if (payload.entityType === "worker") await reconcileCobraWorkerStatuses(payload.entityId, payload.accountId);
    }),
  });
  eventBus.on({
    name: "bao-cobra-lifecycle-case",
    description: "Reconciles COBRA case edits; unchanged decisions do not write or re-emit.",
    event: EventType.BAO_COBRA_CASE_SAVED,
    handler: (payload) => runOutsideTransaction(async () => {
      if (payload.operation !== "deleted") await reconcileCobraWorkerStatuses(payload.coveredPersonWorkerId);
    }),
  });
}
