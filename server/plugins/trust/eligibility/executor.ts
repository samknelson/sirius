import { eligibilityPluginRegistry } from "./registry";
import type {
  EligibilityContext,
  EligibilityResult,
  EligibilityRule,
  ScanType,
} from "./types";
import type { Worker, Contact, Employer, PluginConfig } from "@shared/schema";
import { storage } from "../../../storage/database";
import { logger } from "../../../logger";
import { getEnabledComponentIds } from "../../../modules/components";

/**
 * Reconstruct the in-memory `EligibilityRule` shape the executor evaluates
 * from a unified `plugin_configs` base row (plugin_type = 'trust-eligibility').
 *
 * The base row's `data` jsonb IS the rule config, with the authoritative
 * `appliesTo` scan-type list mirrored inside it. The `pluginId` column is the
 * plugin key. Callers fetch ordered rows via
 * `storage.pluginConfigs.search("trust-eligibility", …)` (already sorted by
 * `ordering, id`, preserving the exact per-benefit evaluation order) and map
 * each `.config` through this helper. `enabled` is intentionally NOT consulted:
 * every configured rule participates in evaluation, exactly as the legacy blob
 * behaved.
 */
export function pluginConfigToEligibilityRule(
  config: PluginConfig,
): EligibilityRule {
  const data = (config.data ?? {}) as Record<string, unknown>;
  const appliesTo = Array.isArray(data.appliesTo)
    ? (data.appliesTo as ScanType[])
    : [];
  return {
    pluginKey: config.pluginId,
    appliesTo,
    config: data,
  };
}

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
  /**
   * Optionally evaluate as if the subscriber's employer is this one
   * ("evaluate as if the subscriber's employer is X"). When omitted, the
   * executor resolves the employer from the subscriber's active trust
   * election as of the evaluation date. When neither yields an employer,
   * the context employer is simply absent.
   */
  employerId?: string;
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

async function loadWorker(workerId: string, cached?: Worker): Promise<Worker> {
  if (cached) return cached;
  const fetched = await storage.workers.getWorker(workerId);
  if (!fetched) {
    throw new Error(`Worker not found: ${workerId}`);
  }
  return fetched;
}

async function loadContactFor(worker: Worker): Promise<Contact | null> {
  if (!worker.contactId) return null;
  const fetched = await storage.contacts.getContact(worker.contactId);
  return fetched ?? null;
}

function asOfDate(asOfYear: number, asOfMonth: number): Date {
  // Last day of the asOf month — matches the convention used by other
  // plugins (e.g. workStatus) for "as of this scan window".
  const d = new Date(asOfYear, asOfMonth, 0);
  return d;
}

function asOfYmd(asOfYear: number, asOfMonth: number): string {
  const d = asOfDate(asOfYear, asOfMonth);
  const yr = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const dy = String(d.getDate()).padStart(2, "0");
  return `${yr}-${mo}-${dy}`;
}

/**
 * Resolve the subscriber's employer for an evaluation. Prefers an
 * externally-supplied employer id; otherwise looks it up from the
 * subscriber's trust election active as of the evaluation date. Returns
 * undefined when neither yields an employer (or the id no longer exists).
 * Tolerant of a missing election/employer — this runs on every
 * evaluation (test page and monthly scan), so it must never throw.
 */
async function resolveEmployer(
  input: EligibilityEvaluationInput,
  asOfMonth: number,
  asOfYear: number,
): Promise<Employer | undefined> {
  if (input.employerId) {
    const supplied = await storage.employers.getEmployer(input.employerId);
    return supplied ?? undefined;
  }
  const election = await storage.workerTrustElections.getActiveByWorkerAsOf(
    input.workerId,
    asOfYmd(asOfYear, asOfMonth),
  );
  if (!election?.employerId) return undefined;
  const fromElection = await storage.employers.getEmployer(election.employerId);
  return fromElection ?? undefined;
}

const ELIGIBILITY_EXEMPTIONS_COMPONENT_ID = "trust.benefits.eligibility.exemptions";

/**
 * When the eligibility-exemptions component is enabled, resolves the set of
 * eligibility plugin keys the SUBSCRIBER worker is exempted from for this
 * benefit on the as-of date. Maps each exempted plugin key to the exemption's
 * description (or null) so callers can surface a reason. Returns an empty map
 * when the component is disabled, no benefit is in scope, or nothing matches.
 */
async function loadExemptedPlugins(
  workerId: string,
  benefitId: string | undefined,
  enabledComponents: string[],
  asOfYear: number,
  asOfMonth: number,
): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>();
  if (!benefitId) return map;
  if (!enabledComponents.includes(ELIGIBILITY_EXEMPTIONS_COMPONENT_ID)) return map;

  const exemptions =
    await storage.trustBenefitEligibilityExemptions.listActiveForWorkerAndBenefit(
      workerId,
      benefitId,
      asOfDate(asOfYear, asOfMonth),
    );

  for (const exemption of exemptions) {
    for (const pluginKey of exemption.eligibilityPlugins ?? []) {
      if (!map.has(pluginKey)) {
        map.set(pluginKey, exemption.description ?? null);
      }
    }
  }
  return map;
}

function exemptionReason(description: string | null | undefined): string {
  return description
    ? `Exempted: ${description}`
    : "Exempted by an eligibility exemption";
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
 * Eagerly resolves subscriber + dependent worker/contact records.
 * Validates the relationship up-front against `worker_relations`;
 * throws `EligibilityRelationshipError` if the row is missing/expired.
 * When no relationship is supplied, dependent fields are the same
 * references as the subscriber fields.
 */
async function buildContextParts(
  input: EligibilityEvaluationInput,
  asOfMonth: number,
  asOfYear: number,
): Promise<{
  subscriberWorker: Worker;
  subscriberContact: Contact | null;
  dependentWorker: Worker;
  dependentContact: Contact | null;
  relationship?: EligibilityContext["relationship"];
  employer?: Employer;
}> {
  const subscriberWorker = await loadWorker(input.workerId, input.worker);
  const subscriberContact = await loadContactFor(subscriberWorker);
  const employer = await resolveEmployer(input, asOfMonth, asOfYear);

  if (!input.relationship) {
    return {
      subscriberWorker,
      subscriberContact,
      dependentWorker: subscriberWorker,
      dependentContact: subscriberContact,
      employer,
    };
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

  const dependentWorker = await loadWorker(dependentWorkerId);
  const dependentContact = await loadContactFor(dependentWorker);

  return {
    subscriberWorker,
    subscriberContact,
    dependentWorker,
    dependentContact,
    relationship: {
      subscriberWorkerId: input.workerId,
      dependentWorkerId,
      relationType: row.relationType,
    },
    employer,
  };
}

export async function evaluateEligibilityRules(
  rules: EligibilityRule[],
  input: EligibilityEvaluationInput
): Promise<EligibilityResult[]> {
  const now = new Date();
  const asOfMonth = input.asOfMonth ?? (now.getMonth() + 1);
  const asOfYear = input.asOfYear ?? now.getFullYear();

  const parts = await buildContextParts(input, asOfMonth, asOfYear);

  const results: EligibilityResult[] = [];

  const enabledComponents = await getEnabledComponentIds();
  const exemptedPlugins = await loadExemptedPlugins(
    input.workerId,
    input.benefitId,
    enabledComponents,
    asOfYear,
    asOfMonth,
  );

  for (const rule of rules) {
    if (!rule.appliesTo.includes(input.scanType)) {
      continue;
    }

    if (exemptedPlugins.has(rule.pluginKey)) {
      results.push({
        eligible: true,
        reason: exemptionReason(exemptedPlugins.get(rule.pluginKey)),
      });
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
      const componentId = plugin.metadata.requiredComponent || 'unknown';
      logger.warn(`Eligibility plugin disabled: ${rule.pluginKey} (requires component: ${componentId})`, {
        service: 'eligibility-executor',
      });
      results.push({
        eligible: true,
        reason: `Component not enabled: ${componentId}`,
      });
      continue;
    }

    const context: EligibilityContext = {
      scanType: input.scanType,
      asOfMonth,
      asOfYear,
      benefitId: input.benefitId,
      ...parts,
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

  const parts = await buildContextParts(input, asOfMonth, asOfYear);

  const pluginResults: BenefitEligibilityResult['results'] = [];
  let overallEligible = true;

  const enabledComponents = await getEnabledComponentIds();
  const exemptedPlugins = await loadExemptedPlugins(
    input.workerId,
    benefitId,
    enabledComponents,
    asOfYear,
    asOfMonth,
  );

  for (const rule of rules) {
    if (!rule.appliesTo.includes(input.scanType)) {
      continue;
    }

    if (exemptedPlugins.has(rule.pluginKey)) {
      pluginResults.push({
        pluginKey: rule.pluginKey,
        eligible: true,
        reason: exemptionReason(exemptedPlugins.get(rule.pluginKey)),
      });
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
      const componentId = plugin.metadata.requiredComponent || 'unknown';
      logger.warn(`Eligibility plugin disabled: ${rule.pluginKey} (requires component: ${componentId})`, {
        service: 'eligibility-executor',
      });
      pluginResults.push({
        pluginKey: rule.pluginKey,
        eligible: true,
        reason: `Component not enabled: ${componentId}`,
      });
      continue;
    }

    const context: EligibilityContext = {
      scanType: input.scanType,
      asOfMonth,
      asOfYear,
      benefitId,
      ...parts,
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
