import { evaluateBenefitEligibility, type BenefitEligibilityResult } from "../eligibility-plugins/executor";
import type { EligibilityRule, ScanType } from "../eligibility-plugins/types";
import type { IStorage } from "../storage";
import type { Worker, Policy, TrustBenefit } from "@shared/schema";
import { logger } from "../logger";

interface PolicyData {
  benefitIds?: string[];
  eligibilityRules?: Record<string, EligibilityRule[]>;
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
  previousMonthBenefitIds: string[];
  actions: BenefitScanAction[];
  summary: {
    totalEvaluated: number;
    eligible: number;
    ineligible: number;
    created: number;
    deleted: number;
    unchanged: number;
  };
}

function getPreviousMonth(month: number, year: number): { month: number; year: number } {
  if (month === 1) {
    return { month: 12, year: year - 1 };
  }
  return { month: month - 1, year };
}

export async function runBenefitsScan(
  storage: IStorage,
  workerId: string,
  month: number,
  year: number,
  mode: "test" | "live"
): Promise<BenefitsScanResult> {
  logger.info(`Starting benefits scan for worker ${workerId}`, {
    service: "benefits-scan",
    workerId,
    month,
    year,
    mode,
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
  const eligibilityRules = policyData.eligibilityRules || {};

  const allBenefits = await storage.trustBenefits.getAllTrustBenefits();
  const benefitsMap = new Map<string, TrustBenefit>(
    allBenefits.map((b: TrustBenefit) => [b.id, b])
  );

  const workerWmbRecords = await storage.workers.getWorkerBenefits(workerId);
  const prevMonth = getPreviousMonth(month, year);
  const previousMonthWmb = workerWmbRecords.filter(
    (wmb: any) => wmb.month === prevMonth.month && wmb.year === prevMonth.year
  );
  const previousMonthBenefitIds = previousMonthWmb.map((wmb: any) => wmb.benefitId);

  const currentMonthWmb = workerWmbRecords.filter(
    (wmb: any) => wmb.month === month && wmb.year === year
  );
  const currentMonthBenefitMap = new Map<string, any>(
    currentMonthWmb.map((wmb: any) => [wmb.benefitId, wmb])
  );

  const actions: BenefitScanAction[] = [];

  for (const benefitId of policyBenefitIds) {
    const benefit = benefitsMap.get(benefitId);
    if (!benefit) {
      logger.warn(`Benefit not found: ${benefitId}`, { service: "benefits-scan" });
      continue;
    }

    const hadPreviousMonth = previousMonthBenefitIds.includes(benefitId);
    const scanType: ScanType = hadPreviousMonth ? "continue" : "start";
    const rules = eligibilityRules[benefitId] || [];

    const eligibilityResult = await evaluateBenefitEligibility(benefitId, rules, {
      scanType,
      workerId,
      worker,
      asOfMonth: month,
      asOfYear: year,
      stopAfterIneligible: false,
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

    actions.push({
      benefitId,
      benefitName: (benefit as any).name || benefitId,
      scanType,
      eligible: eligibilityResult.eligible,
      action,
      actionReason,
      pluginResults: eligibilityResult.results,
    });
  }

  if (mode === "live") {
    for (const action of actions) {
      try {
        if (action.action === "create") {
          await storage.workers.createWorkerBenefit({
            workerId,
            month,
            year,
            employerId: employer?.id || worker.denormHomeEmployerId || "",
            benefitId: action.benefitId,
          });
          action.executed = true;
        } else if (action.action === "delete") {
          const existingRecord = currentMonthBenefitMap.get(action.benefitId);
          if (existingRecord) {
            await storage.workers.deleteWorkerBenefit(existingRecord.id);
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

  const summary = {
    totalEvaluated: actions.length,
    eligible: actions.filter((a) => a.eligible).length,
    ineligible: actions.filter((a) => !a.eligible).length,
    created: actions.filter((a) => a.action === "create" && (mode === "test" || a.executed)).length,
    deleted: actions.filter((a) => a.action === "delete" && (mode === "test" || a.executed)).length,
    unchanged: actions.filter((a) => a.action === "none").length,
  };

  logger.info(`Benefits scan completed for worker ${workerId}`, {
    service: "benefits-scan",
    workerId,
    month,
    year,
    mode,
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
    previousMonthBenefitIds,
    actions,
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
