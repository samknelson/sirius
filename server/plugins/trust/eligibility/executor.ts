import { eligibilityPluginRegistry } from "./registry";
import type {
  EligibilityContext,
  EligibilityRelationshipContext,
  EligibilityResult,
  EligibilityRule,
  ScanType,
} from "./types";
import type { Worker, Contact } from "@shared/schema";
import { storage } from "../../../storage/database";
import { logger } from "../../../logger";
import { getEnabledComponentIds } from "../../../modules/components";

/**
 * Thrown when an eligibility evaluation is requested with a
 * `relationship` that does not correspond to an active
 * `worker_relations` row on the as-of date. Surfaces as a 400 at the
 * route layer rather than producing a misleading evaluation result.
 */
export class EligibilityRelationshipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EligibilityRelationshipError";
  }
}

export interface EligibilityEvaluationInput {
  scanType: ScanType;
  /** Subscriber worker id (the URL worker on the test page). */
  workerId: string;
  worker?: Worker;
  asOfMonth?: number;
  asOfYear?: number;
  stopAfterIneligible?: boolean;
  benefitId?: string;
  /**
   * Optional dependent. When provided, the subscriber is `workerId`
   * and the dependent is `relationship.dependentWorkerId`. The executor
   * validates that an active `worker_relations` row exists between
   * them on the as-of date and exposes both sides on the context.
   */
  relationship?: {
    dependentWorkerId: string;
  };
}

export interface BenefitEligibilityResult {
  benefitId: string;
  eligible: boolean;
  results: Array<{
    pluginKey: string;
    eligible: boolean;
    reason?: string;
    warning?: string;
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

function createContactAccessor(getWorker: () => Promise<Worker>): () => Promise<Contact | null> {
  let cached = false;
  let contact: Contact | null = null;

  return async (): Promise<Contact | null> => {
    if (cached) return contact;

    const worker = await getWorker();
    if (!worker.contactId) {
      cached = true;
      contact = null;
      return contact;
    }

    const fetched = await storage.contacts.getContact(worker.contactId);
    contact = fetched ?? null;
    cached = true;
    return contact;
  };
}

function asOfDate(asOfYear: number, asOfMonth: number): Date {
  // Last day of the asOf month — matches the convention used by other
  // plugins (e.g. workStatus) for "as of this scan window".
  const d = new Date(asOfYear, asOfMonth, 0);
  return d;
}

/**
 * Public hook for routes that need to hard-validate a supplied
 * `relationship` before short-circuiting on "no rules configured".
 * Throws `EligibilityRelationshipError` (→ 400) when the
 * subscriber→dependent pair has no active `worker_relations` row on the
 * as-of date, or when subscriber === dependent. No-ops when
 * `relationship` is undefined.
 */
export async function validateEligibilityRelationship(
  subscriberWorkerId: string,
  relationship: { dependentWorkerId: string } | undefined,
  asOfMonth: number,
  asOfYear: number,
): Promise<void> {
  if (!relationship) return;
  if (relationship.dependentWorkerId === subscriberWorkerId) {
    throw new EligibilityRelationshipError(
      "Subscriber and dependent must be different workers",
    );
  }
  const row = await storage.workerRelations.findActiveBetween(
    subscriberWorkerId,
    relationship.dependentWorkerId,
    asOfDate(asOfYear, asOfMonth),
  );
  if (!row) {
    throw new EligibilityRelationshipError(
      `No active relationship from worker ${subscriberWorkerId} to dependent ${relationship.dependentWorkerId} as of ${asOfYear}-${String(asOfMonth).padStart(2, "0")}`,
    );
  }
}

/**
 * Resolves the input into the per-evaluation accessors and the
 * (optional) dependent relationship context. Validates the relationship
 * up-front against `worker_relations`; throws
 * `EligibilityRelationshipError` if the row is missing/expired.
 */
async function buildContextParts(
  input: EligibilityEvaluationInput,
  asOfMonth: number,
  asOfYear: number,
): Promise<{
  getWorker: () => Promise<Worker>;
  getContact: () => Promise<Contact | null>;
  relationship?: EligibilityRelationshipContext;
}> {
  const getWorker = createWorkerAccessor(input.workerId, input.worker);
  const getContact = createContactAccessor(getWorker);

  if (!input.relationship) {
    return { getWorker, getContact };
  }

  const dependentWorkerId = input.relationship.dependentWorkerId;
  if (dependentWorkerId === input.workerId) {
    throw new EligibilityRelationshipError(
      "Subscriber and dependent must be different workers",
    );
  }

  const row = await storage.workerRelations.findActiveBetween(
    input.workerId,
    dependentWorkerId,
    asOfDate(asOfYear, asOfMonth),
  );
  if (!row) {
    throw new EligibilityRelationshipError(
      `No active relationship from worker ${input.workerId} to dependent ${dependentWorkerId} as of ${asOfYear}-${String(asOfMonth).padStart(2, "0")}`,
    );
  }

  const getDependentWorker = createWorkerAccessor(dependentWorkerId);
  const getDependentContact = createContactAccessor(getDependentWorker);

  const relationship: EligibilityRelationshipContext = {
    subscriberWorkerId: input.workerId,
    dependentWorkerId,
    relationType: row.relationType,
    getSubscriberWorker: getWorker,
    getSubscriberContact: getContact,
    getDependentWorker,
    getDependentContact,
  };

  return { getWorker, getContact, relationship };
}

export async function evaluateEligibilityRules(
  rules: EligibilityRule[],
  input: EligibilityEvaluationInput
): Promise<EligibilityResult[]> {
  const now = new Date();
  const asOfMonth = input.asOfMonth ?? (now.getMonth() + 1);
  const asOfYear = input.asOfYear ?? now.getFullYear();

  const { getWorker, getContact, relationship } = await buildContextParts(
    input,
    asOfMonth,
    asOfYear,
  );

  const results: EligibilityResult[] = [];
  
  const enabledComponents = await getEnabledComponentIds();
  
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

    const isPluginEnabled = eligibilityPluginRegistry.isPluginEnabled(rule.pluginKey, enabledComponents);
    if (!isPluginEnabled) {
      const componentId = plugin.metadata.requiresComponent || 'unknown';
      logger.warn(`Eligibility plugin disabled: ${rule.pluginKey} (requires component: ${componentId})`, {
        service: 'eligibility-executor',
      });
      results.push({ 
        eligible: false, 
        reason: `Plugin disabled: Required component "${componentId}" is not enabled` 
      });
      if (input.stopAfterIneligible !== false) {
        break;
      }
      continue;
    }
    
    const context: EligibilityContext = {
      scanType: input.scanType,
      workerId: input.workerId,
      getWorker,
      getContact,
      asOfMonth,
      asOfYear,
      benefitId: input.benefitId,
      relationship,
    };
    
    try {
      const result = await plugin.evaluate(context, rule.config as any);
      results.push(result);
      
      if (!result.eligible && input.stopAfterIneligible !== false) {
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
      if (input.stopAfterIneligible !== false) {
        break;
      }
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

  const { getWorker, getContact, relationship } = await buildContextParts(
    input,
    asOfMonth,
    asOfYear,
  );

  const pluginResults: BenefitEligibilityResult['results'] = [];
  let overallEligible = true;
  
  const enabledComponents = await getEnabledComponentIds();
  
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

    const isPluginEnabled = eligibilityPluginRegistry.isPluginEnabled(rule.pluginKey, enabledComponents);
    if (!isPluginEnabled) {
      const componentId = plugin.metadata.requiresComponent || 'unknown';
      pluginResults.push({
        pluginKey: rule.pluginKey,
        eligible: false,
        reason: `Plugin disabled: Required component "${componentId}" is not enabled`,
      });
      overallEligible = false;
      if (input.stopAfterIneligible !== false) {
        break;
      }
      continue;
    }
    
    const context: EligibilityContext = {
      scanType: input.scanType,
      workerId: input.workerId,
      getWorker,
      getContact,
      asOfMonth,
      asOfYear,
      benefitId,
      relationship,
    };
    
    try {
      const result = await plugin.evaluate(context, rule.config as any);
      pluginResults.push({
        pluginKey: rule.pluginKey,
        eligible: result.eligible,
        reason: result.reason,
        warning: result.warning,
      });
      
      if (!result.eligible) {
        overallEligible = false;
        if (input.stopAfterIneligible !== false) {
          break;
        }
      }
    } catch (error) {
      pluginResults.push({
        pluginKey: rule.pluginKey,
        eligible: false,
        reason: `Plugin error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
      overallEligible = false;
      if (input.stopAfterIneligible !== false) {
        break;
      }
    }
  }
  
  return {
    benefitId,
    eligible: overallEligible,
    results: pluginResults,
  };
}
