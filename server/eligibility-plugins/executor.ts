import { eligibilityPluginRegistry } from "./registry";
import type { 
  EligibilityContext, 
  EligibilityResult, 
  EligibilityRule,
  ScanType,
} from "./types";
import type { Worker } from "@shared/schema";
import { storage } from "../storage/database";
import { logger } from "../logger";

export interface EligibilityEvaluationInput {
  scanType: ScanType;
  workerId: string;
  worker?: Worker;
  asOfMonth?: number;
  asOfYear?: number;
}

export interface BenefitEligibilityResult {
  benefitId: string;
  eligible: boolean;
  results: Array<{
    pluginKey: string;
    eligible: boolean;
    reason?: string;
  }>;
}

function createWorkerAccessor(workerId: string, cachedWorker?: Worker): () => Promise<Worker> {
  let worker: Worker | undefined = cachedWorker;
  
  return async (): Promise<Worker> => {
    if (worker) return worker;
    
    const fetchedWorker = await storage.workers.getWorker(workerId);
    if (!fetchedWorker) {
      throw new Error(`Worker not found: ${workerId}`);
    }
    worker = fetchedWorker;
    return worker;
  };
}

export async function evaluateEligibilityRules(
  rules: EligibilityRule[],
  input: EligibilityEvaluationInput
): Promise<EligibilityResult[]> {
  const now = new Date();
  const asOfMonth = input.asOfMonth ?? (now.getMonth() + 1);
  const asOfYear = input.asOfYear ?? now.getFullYear();
  
  const getWorker = createWorkerAccessor(input.workerId, input.worker);
  
  const results: EligibilityResult[] = [];
  
  for (const rule of rules) {
    if (!rule.appliesTo.includes(input.scanType)) {
      continue;
    }
    
    const plugin = eligibilityPluginRegistry.get(rule.pluginKey);
    if (!plugin) {
      logger.warn(`Eligibility plugin not found: ${rule.pluginKey}`, {
        service: 'eligibility-executor',
      });
      results.push({ 
        eligible: false, 
        reason: `Plugin not found: ${rule.pluginKey}` 
      });
      continue;
    }
    
    const context: EligibilityContext = {
      scanType: input.scanType,
      workerId: input.workerId,
      getWorker,
      asOfMonth,
      asOfYear,
    };
    
    try {
      const result = await plugin.evaluate(context, rule.config as any);
      results.push(result);
      
      if (!result.eligible) {
        break;
      }
    } catch (error) {
      logger.error(`Error evaluating eligibility plugin: ${rule.pluginKey}`, {
        service: 'eligibility-executor',
        error: error instanceof Error ? error.message : String(error),
      });
      results.push({ 
        eligible: false, 
        reason: `Plugin error: ${error instanceof Error ? error.message : 'Unknown error'}` 
      });
      break;
    }
  }
  
  return results;
}

export async function evaluateBenefitEligibility(
  benefitId: string,
  rules: EligibilityRule[],
  input: EligibilityEvaluationInput
): Promise<BenefitEligibilityResult> {
  const now = new Date();
  const asOfMonth = input.asOfMonth ?? (now.getMonth() + 1);
  const asOfYear = input.asOfYear ?? now.getFullYear();
  
  const getWorker = createWorkerAccessor(input.workerId, input.worker);
  
  const pluginResults: BenefitEligibilityResult['results'] = [];
  let overallEligible = true;
  
  for (const rule of rules) {
    if (!rule.appliesTo.includes(input.scanType)) {
      continue;
    }
    
    const plugin = eligibilityPluginRegistry.get(rule.pluginKey);
    if (!plugin) {
      pluginResults.push({
        pluginKey: rule.pluginKey,
        eligible: false,
        reason: `Plugin not found: ${rule.pluginKey}`,
      });
      overallEligible = false;
      break;
    }
    
    const context: EligibilityContext = {
      scanType: input.scanType,
      workerId: input.workerId,
      getWorker,
      asOfMonth,
      asOfYear,
    };
    
    try {
      const result = await plugin.evaluate(context, rule.config as any);
      pluginResults.push({
        pluginKey: rule.pluginKey,
        eligible: result.eligible,
        reason: result.reason,
      });
      
      if (!result.eligible) {
        overallEligible = false;
        break;
      }
    } catch (error) {
      pluginResults.push({
        pluginKey: rule.pluginKey,
        eligible: false,
        reason: `Plugin error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
      overallEligible = false;
      break;
    }
  }
  
  return {
    benefitId,
    eligible: overallEligible,
    results: pluginResults,
  };
}
