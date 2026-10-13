import {
  evaluateBenefitEligibility,
  pluginConfigToEligibilityRule,
  type BenefitEligibilityResult,
} from "../plugins/trust/eligibility/executor";
import type { EligibilityRule, ScanType } from "../plugins/trust/eligibility/types";
import type { IStorage } from "../storage";
import type { Worker, Policy, TrustBenefit, PluginConfigBenefitEligibility, WorkerTrustElection } from "@shared/schema";
import { wmbScanWindow } from "./wmb-scan-window";
import { logger } from "../logger";
import { isComponentEnabledSync } from "./component-cache";
import {
  withWmbBenefitRoleHistoryInvalidationBatch,
  withWmbScanWrites,
} from "../middleware/request-context";
import { runInSavepoint, runInTransaction } from "../storage/transaction-context";
import {
  resolveEmployerPolicyAsOf,
  createPolicyResolutionCache,
  type PolicyResolutionCache,
} from "./policy-resolution";

interface PolicyData {
  benefitIds?: string[];
}

export interface BenefitScanAction {
  benefitId: string;
  benefitName: string;
  scanType: ScanType;
  eligible: boolean;
  action: "create" | "delete" | "none";
  actionReason: string;
  pluginResults: BenefitEligibilityResult["results"];
  executed?: boolean;
  executionError?: string;
}

export interface BenefitScanPerson {
  workerId: string;
  name: string;
  role: "subscriber" | "dependent";
  /** Relationship type to the subscriber (dependents only). */
  relationType: string | null;
  previousMonthBenefitIds: string[];
  actions: BenefitScanAction[];
  sourceRelationId?: string | null;
  error?: string;
}

export interface BenefitsScanResult {
  workerId: string;
  month: number;
  year: number;
  mode: "test" | "live";
  policyId: string;
  policyName: string;
  policySource: string;
  employerId: string | null;
  employerName: string | null;
  /** Subscriber's previous-month benefits (kept for backward compatibility). */
  previousMonthBenefitIds: string[];
  /** Subscriber's actions (kept for backward compatibility with the batch scan). */
  actions: BenefitScanAction[];
  /** Every person evaluated: subscriber first, then each covered dependent. */
  people: BenefitScanPerson[];
  summary: {
    totalEvaluated: number;
    eligible: number;
    ineligible: number;
    created: number;
    deleted: number;
    unchanged: number;
  };
}

export interface RunBenefitsScanOptions {
  /**
     * Evaluate elected starts and prior/current attributed dependent coverage.
     * Standalone callers can opt out; queue jobs always evaluate dependents.
   */
  includeDependents?: boolean;
  /**
   * Shared per-run policy-resolution cache. Batch loops pass one cache
   * across all their scans so each employer's policy history (and the
   * system default) is fetched once per run, not once per worker.
   */
  policyCache?: PolicyResolutionCache;
}

/**
 * Run the per-benefit fixed-point eligibility evaluation for a single
 * person (the subscriber, or one dependent). When `relationship` is set,
 * the executor evaluates dependent coverage via the Election plugin and
 * the person's `trust_wmb` rows are keyed to the dependent's own worker id.
 *
 * Fixed-point evaluation: rules like "Linked benefits" ask whether the
 * person has some OTHER benefit in the as-of month, and that other benefit
 * may itself be created (or deleted) by THIS scan. A single pass against
 * the database would miss those same-run outcomes, so we iterate: each
 * pass evaluates every benefit against the effective this-month set from
 * the previous pass (existing records minus deletes plus creates), until
 * the set stops changing. Bounded by benefit count + 1 — each productive
 * pass changes at least one membership, so a cycle that long has converged
 * or is oscillating, in which case the last pass stands.
 */
async function evaluatePersonBenefits(
  storage: IStorage,
  params: {
    subscriberWorkerId: string;
    subscriberWorker: Worker;
    personWorkerId: string;
    relationship: { dependentWorkerId: string; relationId?: string } | undefined;
    /**
     * The worker_relations row this person's coverage comes through
     * (dependents only). Persisted on every WMB row the scan creates so
     * staff can tell an own benefit from a relation-sourced one. Not part
     * of ownership: scans only match rows with this exact source, never
     * another subscriber's coverage or this person's independent coverage.
     */
    sourceRelationId: string | null;
    election: WorkerTrustElection | null;
    allowStarts: boolean;
    month: number;
    year: number;
    mode: "test" | "live";
    employerIdForCreate: string;
    policyBenefitIds: string[];
    benefitsMap: Map<string, TrustBenefit>;
    rulesByBenefit: Map<string, EligibilityRule[]>;
  },
): Promise<{ previousMonthBenefitIds: string[]; actions: BenefitScanAction[] }> {
  const {
    subscriberWorkerId,
    subscriberWorker,
    personWorkerId,
    relationship,
    sourceRelationId,
    election,
    allowStarts,
    month,
    year,
    mode,
    employerIdForCreate,
    policyBenefitIds,
    benefitsMap,
    rulesByBenefit,
  } = params;

  const personWmbRecords = (await storage.trust.wmb.getWorkerBenefits(personWorkerId))
    .filter(wmb => (wmb.sourceRelationId ?? null) === sourceRelationId);
  const prevMonth = wmbScanWindow(month, year).previous;
  const previousMonthWmb = personWmbRecords.filter(
    (wmb: any) => wmb.month === prevMonth.month && wmb.year === prevMonth.year,
  );
  const previousMonthBenefitIds = previousMonthWmb.map((wmb: any) => wmb.benefitId);

  const currentMonthWmb = personWmbRecords.filter(
    (wmb: any) => wmb.month === month && wmb.year === year,
  );
  const currentMonthBenefitMap = new Map<string, any[]>();
  for (const row of currentMonthWmb) {
    const rows = currentMonthBenefitMap.get(row.benefitId) ?? [];
    rows.push(row);
    currentMonthBenefitMap.set(row.benefitId, rows);
  }
  const coverageBenefitIds = new Set([...previousMonthBenefitIds, ...currentMonthBenefitMap.keys()]);
  const canStart = allowStarts || (sourceRelationId === null && coverageBenefitIds.size === 0);
  const evaluationBenefitIds = [...new Set([
    ...(canStart ? policyBenefitIds : []), ...coverageBenefitIds,
  ])].sort();

  let actions: BenefitScanAction[] = [];
  let presentBenefitIds = new Set<string>(currentMonthBenefitMap.keys());
  const maxPasses = evaluationBenefitIds.length + 1;

  for (let pass = 0; pass < maxPasses; pass++) {
    const passActions: BenefitScanAction[] = [];

    for (const benefitId of evaluationBenefitIds) {
      const benefit = benefitsMap.get(benefitId);
      if (!benefit) {
        throw new Error(`Coverage benefit not found: ${benefitId}`);
      }

      const hadPreviousMonth = coverageBenefitIds.has(benefitId);
      const scanType: ScanType = hadPreviousMonth ? "continue" : "start";
      const rules = rulesByBenefit.get(benefitId) || [];

      // Policy membership and selected, valid relationships are scan guards.
      // Benefit selection belongs to the configured Election rule; Linked
      // rules may grant unelected benefits from this dependent's effective set.
      const refusal = !policyBenefitIds.includes(benefitId)
        ? "Benefit is no longer in the subscriber policy"
        : relationship && !allowStarts
          ? "Dependent is no longer selected by a date-valid subscriber election relationship"
          : null;
      const applicableRules = rules.filter(rule => rule.appliesTo.includes(scanType));
      if (!refusal && applicableRules.length === 0) {
        throw new Error(`No ${scanType} eligibility rules configured for benefit ${benefitId} in subscriber policy`);
      }
      const eligibilityResult = refusal ? {
        eligible: false,
        results: [{ pluginKey: "coverage-context", eligible: false, reason: refusal }],
      } : await evaluateBenefitEligibility(benefitId, rules, {
        scanType,
        workerId: subscriberWorkerId,
        worker: subscriberWorker,
        relationship,
        election,
        employerId: employerIdForCreate || undefined,
        asOfMonth: month,
        asOfYear: year,
        stopAfterIneligible: false,
        presentBenefitIds,
      });
      const evaluationError = eligibilityResult.results.find(r =>
        r.reason?.startsWith("Plugin error:") || r.reason?.startsWith("Plugin not found:"));

      const hasCurrentRecord = currentMonthBenefitMap.has(benefitId);
      let action: "create" | "delete" | "none";
      let actionReason: string;

      if (evaluationError) {
        action = "none";
        actionReason = evaluationError.reason!;
      } else if (eligibilityResult.eligible) {
        if (hasCurrentRecord) {
          action = "none";
          actionReason = "Already has benefit for this month";
        } else {
          action = "create";
          actionReason = `Passed ${scanType} eligibility scan`;
        }
      } else {
        if (hasCurrentRecord) {
          action = "delete";
          actionReason = `Failed ${scanType} eligibility scan - removing existing record`;
        } else {
          action = "none";
          actionReason = `Failed ${scanType} eligibility scan - no record to remove`;
        }
      }

      passActions.push({
        benefitId,
        benefitName: (benefit as any).name || benefitId,
        scanType,
        eligible: eligibilityResult.eligible,
        action,
        actionReason,
        pluginResults: eligibilityResult.results,
        ...(evaluationError ? { executionError: evaluationError.reason } : {}),
      });
    }

    // Effective this-month set implied by this pass's outcomes.
    const nextPresent = new Set<string>(currentMonthBenefitMap.keys());
    for (const a of passActions) {
      if (a.action === "create") nextPresent.add(a.benefitId);
      if (a.action === "delete") nextPresent.delete(a.benefitId);
    }

    actions = passActions;
    const converged =
      nextPresent.size === presentBenefitIds.size &&
      Array.from(nextPresent).every((id) => presentBenefitIds.has(id));
    presentBenefitIds = nextPresent;
    if (converged) break;
    if (pass === maxPasses - 1) {
      logger.warn(
        `Benefits scan did not converge after ${maxPasses} passes; using last pass's results`,
        { service: "benefits-scan", workerId: personWorkerId, month, year },
      );
    }
  }

  if (mode === "live") {
    // Loop guard: mark these writes as scan-originated so the WMB auto-rescan
    // listener ignores the WMB_SAVED events they emit. Without this, every
    // row a scan creates/deletes would re-enqueue follow-up scans, whose own
    // writes would enqueue more — an unbounded feedback loop. Other listeners
    // (charges, audit) still run normally.
    // One worker's scan is the largest source transaction we permit.  The
    // collector turns every WMB change in it into one durable invalidation per
    // affected worker/config before commit; a later worker gets its own
    // transaction, so a corrective scan never holds tens of thousands in RAM
    // or one enormous transaction.
    await runInTransaction(async () =>
      withWmbBenefitRoleHistoryInvalidationBatch(
        (workerIds) => storage.trust.wmb.enqueueBenefitRoleHistoryInvalidations(workerIds),
        async () => {
          await withWmbScanWrites(async () => {
            for (const action of actions) {
              try {
                if (action.action === "create") {
                  if (!employerIdForCreate) throw new Error("Subscriber employer is unresolved");
                  await runInSavepoint(() =>
                    storage.trust.wmb.createWorkerBenefit({
                      workerId: personWorkerId,
                      month,
                      year,
                      employerId: employerIdForCreate,
                      benefitId: action.benefitId,
                      sourceRelationId,
                    }),
                  );
                  action.executed = true;
                } else if (action.action === "delete") {
                  const existingRecord = currentMonthBenefitMap.get(action.benefitId);
                  if (existingRecord) {
                    for (const row of existingRecord) {
                      await runInSavepoint(() =>
                        storage.trust.wmb.deleteWorkerBenefit(row.id),
                      );
                    }
                    action.executed = true;
                  }
                }
              } catch (error) {
                action.executed = false;
                action.executionError = error instanceof Error ? error.message : String(error);
                logger.error(`Failed to execute action for benefit ${action.benefitId}`, {
                  service: "benefits-scan",
                  error: action.executionError,
                });
              }
            }
          });
        },
      ),
    );
  }

  return { previousMonthBenefitIds, actions };
}

/**
 * Resolve the dependents covered by the subscriber's active trust election
 * as of the scan month. Each covered relationship links the subscriber to a
 * dependent worker; only relationships that are still active as of the scan
 * date are returned (a dependent whose relationship has lapsed is not
 * covered). Reuses the elections / worker-relations storage layers.
 */
async function resolveCoveredDependents(
  storage: IStorage,
  subscriberWorkerId: string,
  month: number,
  year: number,
  election: WorkerTrustElection | null,
): Promise<Array<{ workerId: string; name: string; relationType: string | null; relationId: string; allowStarts: boolean }>> {
  const asOfDate = new Date(year, month, 0);

  const relationshipIds = new Set(election?.relationshipIds ?? []);

  // The executor validates the relationship directionally (subscriber must be
  // `worker_1`), so we enumerate the subscriber's `worker_1` relations that are
  // active as of the scan date. `searchWorkerRelations` also resolves each
  // dependent's name and relation-type label in one call.
  const relations = relationshipIds.size ? await storage.workerRelations.searchWorkerRelations({
    workerId: subscriberWorkerId,
    role: "worker_1",
    activeAt: asOfDate,
  }) : [];

  const seen = new Set<string>();
  const dependents: Array<{ workerId: string; name: string; relationType: string | null; relationId: string; allowStarts: boolean }> = [];

  for (const rel of [...relations].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!relationshipIds.has(rel.id)) continue;
    const dependentWorkerId = rel.worker2;
    if (rel.worker1 !== subscriberWorkerId || dependentWorkerId === subscriberWorkerId || seen.has(dependentWorkerId)) continue;
    seen.add(dependentWorkerId);

    const ow = rel.otherWorker;
    const name =
      (ow
        ? [ow.given, ow.family].filter(Boolean).join(" ").trim() || ow.displayName
        : null) || dependentWorkerId;
    dependents.push({
      workerId: dependentWorkerId,
      name,
      relationType: rel.relationTypeName ?? null,
      relationId: rel.id,
      allowStarts: true,
    });
  }
  // Stop candidates deliberately ignore today's membership and relation dates.
  // Preserve each source identity, even if the same person has a new relation.
  const coverage = await storage.trust.wmb.getSubscriberDependentCoverage(subscriberWorkerId, month, year);
  for (const row of coverage) {
    if (!row.sourceRelationId || dependents.some(dep => dep.workerId === row.workerId && dep.relationId === row.sourceRelationId)) continue;
    if (row.workerId === subscriberWorkerId) throw new Error(`Invalid self-dependent coverage source ${row.sourceRelationId}`);
    dependents.push({
      workerId: row.workerId,
      name: await storage.workers.getWorkerDisplayName(row.workerId),
      relationType: row.relationType,
      relationId: row.sourceRelationId,
      allowStarts: false,
    });
  }

  // Stop stale grants before attempting starts under a replacement relation.
  return dependents.sort((a, b) =>
    Number(a.allowStarts) - Number(b.allowStarts) ||
    a.workerId.localeCompare(b.workerId) || a.relationId.localeCompare(b.relationId));
}

export async function runBenefitsScan(
  storage: IStorage,
  workerId: string,
  month: number,
  year: number,
  mode: "test" | "live",
  options: RunBenefitsScanOptions = {},
): Promise<BenefitsScanResult> {
  // The trust-eligibility rules and their subsidiary table
  // (plugin_configs_benefit_eligibility) are owned by the trust.benefits
  // component. Scans are only ever triggered under trust.benefits.scan (a child
  // of trust.benefits), so this is a defensive guard: never query the subsidiary
  // when trust benefits are disabled.
  if (!isComponentEnabledSync("trust.benefits")) {
    throw new Error(
      "Trust Benefits component is disabled; benefits scan cannot run",
    );
  }

  logger.info(`Starting benefits scan for worker ${workerId}`, {
    service: "benefits-scan",
    workerId,
    month,
    year,
    mode,
    includeDependents: !!options.includeDependents,
  });

  const worker = await storage.workers.getWorker(workerId);
  if (!worker) {
    throw new Error(`Worker not found: ${workerId}`);
  }

  const { policy, policySource, employer, election } = await resolveWorkerPolicy(
    storage,
    worker,
    month,
    year,
    options.policyCache ?? createPolicyResolutionCache(),
  );
  if (!policy) {
    throw new Error("No policy found for worker");
  }

  const policyData = (policy.data as PolicyData) || {};
  const policyBenefitIds = policyData.benefitIds || [];

  // Load every trust-eligibility rule for this policy in one query and group
  // by benefit, preserving the search dispatcher's `ordering, id` sort so each
  // benefit's rules evaluate in their exact configured sequence.
  const ruleRows = await storage.pluginConfigs.search("trust-eligibility", {
    policy: policy.id,
  });
  const rulesByBenefit = new Map<string, EligibilityRule[]>();
  for (const row of ruleRows) {
    const benefitId = (row.subsidiary as PluginConfigBenefitEligibility | null)?.benefit;
    if (!benefitId) continue;
    const list = rulesByBenefit.get(benefitId) ?? [];
    list.push(pluginConfigToEligibilityRule(row.config));
    rulesByBenefit.set(benefitId, list);
  }

  const allBenefits = await storage.trustBenefits.getAllTrustBenefits();
  const benefitsMap = new Map<string, TrustBenefit>(
    allBenefits.map((b: TrustBenefit) => [b.id, b])
  );

  const employerIdForCreate = employer?.id || worker.denormHomeEmployerId || "";

  const people: BenefitScanPerson[] = [];

  // 1) Subscriber (the worker in the URL) — evaluated with no relationship.
  const subscriberName = await storage.workers.getWorkerDisplayName(workerId);
  try {
  const subscriberResult = await evaluatePersonBenefits(storage, {
    subscriberWorkerId: workerId,
    subscriberWorker: worker,
    personWorkerId: workerId,
    relationship: undefined,
    sourceRelationId: null,
    election,
    allowStarts: !!election,
    month,
    year,
    mode,
    employerIdForCreate,
    policyBenefitIds,
    benefitsMap,
    rulesByBenefit,
  });
  people.push({
    workerId,
    name: subscriberName,
    role: "subscriber",
    relationType: null,
    previousMonthBenefitIds: subscriberResult.previousMonthBenefitIds,
    actions: subscriberResult.actions,
  });
  } catch (error) {
    people.push({
      workerId, name: subscriberName, role: "subscriber", relationType: null,
      previousMonthBenefitIds: [], actions: [],
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // 2) Covered dependents — each evaluated with the subscriber→dependent
  // relationship context so the Election plugin checks dependent coverage,
  // and each dependent's benefit records are keyed to their own worker id.
  if (options.includeDependents) {
    const dependents = await resolveCoveredDependents(storage, workerId, month, year, election);
    for (const dep of dependents) {
      try {
      const depResult = await evaluatePersonBenefits(storage, {
        subscriberWorkerId: workerId,
        subscriberWorker: worker,
        personWorkerId: dep.workerId,
        relationship: { dependentWorkerId: dep.workerId, relationId: dep.relationId },
        sourceRelationId: dep.relationId,
        election,
        allowStarts: dep.allowStarts,
        month,
        year,
        mode,
        employerIdForCreate,
        policyBenefitIds,
        benefitsMap,
        rulesByBenefit,
      });
      people.push({
        workerId: dep.workerId,
        name: dep.name,
        role: "dependent",
        relationType: dep.relationType,
        previousMonthBenefitIds: depResult.previousMonthBenefitIds,
        actions: depResult.actions,
        sourceRelationId: dep.relationId,
      });
      } catch (error) {
        people.push({
          workerId: dep.workerId, name: dep.name, role: "dependent",
          relationType: dep.relationType, sourceRelationId: dep.relationId,
          previousMonthBenefitIds: [], actions: [],
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  const allActions = people.flatMap((p) => p.actions);
  const summary = {
    totalEvaluated: allActions.length,
    eligible: allActions.filter((a) => a.eligible).length,
    ineligible: allActions.filter((a) => !a.eligible).length,
    created: allActions.filter((a) => a.action === "create" && (mode === "test" || a.executed)).length,
    deleted: allActions.filter((a) => a.action === "delete" && (mode === "test" || a.executed)).length,
    unchanged: allActions.filter((a) => a.action === "none").length,
  };

  logger.info(`Benefits scan completed for worker ${workerId}`, {
    service: "benefits-scan",
    workerId,
    month,
    year,
    mode,
    peopleEvaluated: people.length,
    summary,
  });

  return {
    workerId,
    month,
    year,
    mode,
    policyId: policy.id,
    policyName: policy.name || policy.siriusId,
    policySource,
    employerId: employer?.id || null,
    employerName: employer?.name || null,
    previousMonthBenefitIds: people[0].previousMonthBenefitIds,
    actions: people[0].actions,
    people,
    summary,
  };
}

async function resolveWorkerPolicy(
  storage: IStorage,
  worker: Worker,
  month: number,
  year: number,
  policyCache: PolicyResolutionCache,
): Promise<{ policy: Policy | null; policySource: string; employer: any | null; election: WorkerTrustElection | null }> {
  // 1) Pick the EMPLOYER: the worker's active election for the scan month
  // (its employer, never its stored policy — the policy is derived from
  // employer history so plan-rule changes take effect without touching
  // elections), falling back to the worker's home employer.
  // Use the last day of the scan month as the election "as of" date
  // (matching the dependent-coverage resolution in this file) so an election
  // that becomes active at any point during the scan month is picked up.
  const { monthEndYmd: electionAsOfYmd } = wmbScanWindow(month, year);
  const election = await storage.workerTrustElections.getActiveByWorkerAsOf(
    worker.id,
    electionAsOfYmd,
  );

  let employer: any | null = null;
  if (election?.employerId) {
    employer = (await storage.employers.getEmployer(election.employerId)) ?? null;
  }
  if (!employer && worker.denormHomeEmployerId) {
    employer =
      (await storage.employers.getEmployer(worker.denormHomeEmployerId)) ?? null;
  }

  // 2) Resolve the policy from the employer's policy history as of the scan
  // month (history → employer current policy → system default), via the
  // shared resolver so every consumer applies the same chain.
  const targetDate = `${year}-${String(month).padStart(2, "0")}-01`;
  const resolved = await resolveEmployerPolicyAsOf(
    storage,
    employer?.id ?? null,
    targetDate,
    policyCache,
  );
  return { policy: resolved.policy, policySource: resolved.policySource, employer, election: election ?? null };
}
