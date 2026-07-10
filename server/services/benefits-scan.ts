import {
  evaluateBenefitEligibility,
  pluginConfigToEligibilityRule,
  type BenefitEligibilityResult,
} from "../plugins/trust/eligibility/executor";
import type { EligibilityRule, ScanType } from "../plugins/trust/eligibility/types";
import type { IStorage } from "../storage";
import type { Worker, Policy, TrustBenefit, PluginConfigBenefitEligibility } from "@shared/schema";
import { logger } from "../logger";
import { isComponentEnabledSync } from "./component-cache";

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
   * When true, the scan also evaluates every dependent covered by the
   * subscriber's active trust election and creates/removes `trust_wmb`
   * rows keyed to each dependent's own worker id. Off by default so the
   * monthly/batch policy-wide scan (which already enqueues each dependent
   * worker as its own subscriber job) does not double-process dependents.
   */
  includeDependents?: boolean;
}

function getPreviousMonth(month: number, year: number): { month: number; year: number } {
  if (month === 1) {
    return { month: 12, year: year - 1 };
  }
  return { month: month - 1, year };
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
    relationship: { dependentWorkerId: string } | undefined;
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
    month,
    year,
    mode,
    employerIdForCreate,
    policyBenefitIds,
    benefitsMap,
    rulesByBenefit,
  } = params;

  const personWmbRecords = await storage.trust.wmb.getWorkerBenefits(personWorkerId);
  const prevMonth = getPreviousMonth(month, year);
  const previousMonthWmb = personWmbRecords.filter(
    (wmb: any) => wmb.month === prevMonth.month && wmb.year === prevMonth.year,
  );
  const previousMonthBenefitIds = previousMonthWmb.map((wmb: any) => wmb.benefitId);

  const currentMonthWmb = personWmbRecords.filter(
    (wmb: any) => wmb.month === month && wmb.year === year,
  );
  const currentMonthBenefitMap = new Map<string, any>(
    currentMonthWmb.map((wmb: any) => [wmb.benefitId, wmb]),
  );

  let actions: BenefitScanAction[] = [];
  let presentBenefitIds = new Set<string>(currentMonthBenefitMap.keys());
  const maxPasses = policyBenefitIds.length + 1;

  for (let pass = 0; pass < maxPasses; pass++) {
    const passActions: BenefitScanAction[] = [];

    for (const benefitId of policyBenefitIds) {
      const benefit = benefitsMap.get(benefitId);
      if (!benefit) {
        if (pass === 0) {
          logger.warn(`Benefit not found: ${benefitId}`, { service: "benefits-scan" });
        }
        continue;
      }

      const hadPreviousMonth = previousMonthBenefitIds.includes(benefitId);
      const scanType: ScanType = hadPreviousMonth ? "continue" : "start";
      const rules = rulesByBenefit.get(benefitId) || [];

      const eligibilityResult = await evaluateBenefitEligibility(benefitId, rules, {
        scanType,
        workerId: subscriberWorkerId,
        worker: subscriberWorker,
        relationship,
        asOfMonth: month,
        asOfYear: year,
        stopAfterIneligible: false,
        presentBenefitIds,
      });

      const hasCurrentRecord = currentMonthBenefitMap.has(benefitId);
      let action: "create" | "delete" | "none";
      let actionReason: string;

      if (eligibilityResult.eligible) {
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
    for (const action of actions) {
      try {
        if (action.action === "create") {
          await storage.trust.wmb.createWorkerBenefit({
            workerId: personWorkerId,
            month,
            year,
            employerId: employerIdForCreate,
            benefitId: action.benefitId,
          });
          action.executed = true;
        } else if (action.action === "delete") {
          const existingRecord = currentMonthBenefitMap.get(action.benefitId);
          if (existingRecord) {
            await storage.trust.wmb.deleteWorkerBenefit(existingRecord.id);
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
): Promise<Array<{ workerId: string; name: string; relationType: string | null }>> {
  const asOfDate = new Date(year, month, 0);
  const asOfYmd = `${asOfDate.getFullYear()}-${String(asOfDate.getMonth() + 1).padStart(2, "0")}-${String(asOfDate.getDate()).padStart(2, "0")}`;

  const election = await storage.workerTrustElections.getActiveByWorkerAsOf(
    subscriberWorkerId,
    asOfYmd,
  );
  if (!election) return [];

  const relationshipIds = new Set(election.relationshipIds ?? []);
  if (relationshipIds.size === 0) return [];

  // The executor validates the relationship directionally (subscriber must be
  // `worker_1`), so we enumerate the subscriber's `worker_1` relations that are
  // active as of the scan date. `searchWorkerRelations` also resolves each
  // dependent's name and relation-type label in one call.
  const relations = await storage.workerRelations.searchWorkerRelations({
    workerId: subscriberWorkerId,
    role: "worker_1",
    activeAt: asOfDate,
  });

  const seen = new Set<string>();
  const dependents: Array<{ workerId: string; name: string; relationType: string | null }> = [];

  for (const rel of relations) {
    if (!relationshipIds.has(rel.id)) continue;
    const dependentWorkerId = rel.worker2;
    if (dependentWorkerId === subscriberWorkerId || seen.has(dependentWorkerId)) continue;
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
    });
  }

  return dependents;
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

  const { policy, policySource, employer } = await resolveWorkerPolicy(storage, worker, month, year);
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
  const subscriberResult = await evaluatePersonBenefits(storage, {
    subscriberWorkerId: workerId,
    subscriberWorker: worker,
    personWorkerId: workerId,
    relationship: undefined,
    month,
    year,
    mode,
    employerIdForCreate,
    policyBenefitIds,
    benefitsMap,
    rulesByBenefit,
  });
  const subscriberName = await storage.workers.getWorkerDisplayName(workerId);
  people.push({
    workerId,
    name: subscriberName,
    role: "subscriber",
    relationType: null,
    previousMonthBenefitIds: subscriberResult.previousMonthBenefitIds,
    actions: subscriberResult.actions,
  });

  // 2) Covered dependents — each evaluated with the subscriber→dependent
  // relationship context so the Election plugin checks dependent coverage,
  // and each dependent's benefit records are keyed to their own worker id.
  if (options.includeDependents) {
    const dependents = await resolveCoveredDependents(storage, workerId, month, year);
    for (const dep of dependents) {
      const depResult = await evaluatePersonBenefits(storage, {
        subscriberWorkerId: workerId,
        subscriberWorker: worker,
        personWorkerId: dep.workerId,
        relationship: { dependentWorkerId: dep.workerId },
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
      });
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
  year: number
): Promise<{ policy: Policy | null; policySource: string; employer: any | null }> {
  let employer = null;

  // 1) The worker's own benefit election is the most specific, authoritative
  // source of their policy for the scan month. An election records the exact
  // policy (and employer) the worker enrolled under, so it wins over the
  // employer's policy history / current policy / the system default.
  // Use the last day of the scan month as the "as of" date (matching the
  // dependent-coverage resolution in this file) so an election that becomes
  // active at any point during the scan month is picked up.
  const monthEnd = new Date(year, month, 0);
  const electionAsOfYmd = `${monthEnd.getFullYear()}-${String(monthEnd.getMonth() + 1).padStart(2, "0")}-${String(monthEnd.getDate()).padStart(2, "0")}`;
  const election = await storage.workerTrustElections.getActiveByWorkerAsOf(
    worker.id,
    electionAsOfYmd,
  );
  if (election?.policyId) {
    const policy = await storage.policies.getPolicyById(election.policyId);
    if (policy) {
      const electionEmployer = election.employerId
        ? await storage.employers.getEmployer(election.employerId)
        : null;
      return {
        policy,
        policySource: electionEmployer
          ? `Worker election (${electionEmployer.name || electionEmployer.siriusId})`
          : "Worker election",
        employer: electionEmployer,
      };
    }
  }

  if (worker.denormHomeEmployerId) {
    employer = await storage.employers.getEmployer(worker.denormHomeEmployerId);
    
    if (employer) {
      const policyHistory = await storage.employerPolicyHistory.getEmployerPolicyHistory(employer.id);
      const targetDate = `${year}-${String(month).padStart(2, "0")}-01`;
      
      const effectiveEntry = policyHistory
        .filter((entry: any) => entry.date <= targetDate)
        .sort((a: any, b: any) => b.date.localeCompare(a.date))[0];
      
      if (effectiveEntry?.policy) {
        return {
          policy: effectiveEntry.policy,
          policySource: `Employer policy history (${employer.name || employer.siriusId})`,
          employer,
        };
      }
      
      if (employer.denormPolicyId) {
        const policy = await storage.policies.getPolicyById(employer.denormPolicyId);
        if (policy) {
          return {
            policy,
            policySource: `Employer current policy (${employer.name || employer.siriusId})`,
            employer,
          };
        }
      }
    }
  }

  const defaultPolicyVar = await storage.variables.getByName("policy_default");
  if (defaultPolicyVar?.value) {
    const policyId = defaultPolicyVar.value as string;
    const policy = await storage.policies.getPolicyById(policyId);
    if (policy) {
      return {
        policy,
        policySource: "System default policy",
        employer,
      };
    }
  }

  return { policy: null, policySource: "None", employer };
}
