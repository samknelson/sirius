import {
  siriusIdPlanHash,
  type SiriusIdOwnershipAction,
  type SiriusIdOwnershipPlan,
  type SiriusIdOwnershipSnapshot,
} from "../storage/workers/sirius-id-ownership-plan";

const DASHBOARD_DECISION_LIMIT = 200;
const CLEAN_ACTIONS: ReadonlySet<SiriusIdOwnershipAction> = new Set([
  "correct",
  "new_claim_reserved",
]);

/** Pure, bounded dashboard projection. Aggregate fields and the approval hash
 * always describe the complete plan, while the decision list contains issues
 * requiring operator attention only. */
export function projectSiriusIdOwnershipDashboard(
  snapshot: SiriusIdOwnershipSnapshot,
  plan: SiriusIdOwnershipPlan | null,
) {
  if (!snapshot.stagingPresent) {
    return {
      stagingPresent: false,
      idMapPresent: snapshot.idMapPresent,
      stagedClaims: 0,
      decisions: [],
      decisionsTruncated: false,
      actionCounts: {},
      hardBlockers: 1,
      pendingRekeys: 0,
      planHash: null,
    };
  }
  if (plan == null) {
    throw new Error("A Sirius ID ownership plan is required when staging is present.");
  }

  const actionCounts: Partial<Record<SiriusIdOwnershipAction, number>> = {};
  for (const decision of plan.decisions) {
    actionCounts[decision.action] = (actionCounts[decision.action] ?? 0) + 1;
  }
  const issues = plan.decisions.filter((decision) => !CLEAN_ACTIONS.has(decision.action));

  return {
    stagingPresent: true,
    idMapPresent: snapshot.idMapPresent,
    stagedClaims: snapshot.claims.length,
    decisions: issues.slice(0, DASHBOARD_DECISION_LIMIT),
    decisionsTruncated: issues.length > DASHBOARD_DECISION_LIMIT,
    actionCounts,
    hardBlockers: plan.hardBlockers,
    pendingRekeys: plan.pendingRekeys,
    planHash: siriusIdPlanHash(plan),
  };
}