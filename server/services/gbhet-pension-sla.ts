import { storage } from "../storage";
import { logger } from "../logger";
import type { GbhetPensionAccrualTier, GbhetPensionPlanYear } from "../storage/gbhet-pension";
import type { Ledger } from "@shared/schema";

export class SlaConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SlaConfigError";
  }
}

const PLUGIN_ID = "gbhet-pension-sla-hourly";
const REFERENCE_TYPE = "pension_sla";
export const SLA_ACCOUNT_VARIABLE = "gbhet_pension_sla_account_id";
export const SLA_TRIGGER_ACCOUNT_VARIABLE = "gbhet_pension_sla_trigger_account_id";

let cachedAccountId: string | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 60_000;

export function clearAccountCache() {
  cachedAccountId = null;
  cacheTimestamp = 0;
}

async function resolveAccountId(): Promise<string> {
  if (cachedAccountId && Date.now() - cacheTimestamp < CACHE_TTL_MS) return cachedAccountId;
  const variable = await storage.variables.getByName(SLA_ACCOUNT_VARIABLE);
  const accountIdValue = variable?.value as string | null;
  if (!accountIdValue) {
    throw new SlaConfigError(
      `SLA ledger account not configured. Set the account in Pension SLA Settings.`
    );
  }
  const account = await storage.ledger.accounts.get(accountIdValue);
  if (!account) {
    throw new SlaConfigError(
      `Configured SLA ledger account not found. Check the Pension SLA Settings.`
    );
  }
  cachedAccountId = account.id;
  cacheTimestamp = Date.now();
  return account.id;
}

export interface SlaCalculationResult {
  workerId: string;
  year: number;
  totalHours: number;
  accrualPct: number;
  benefitRate: number;
  plan: string;
  amount: string;
  description: string;
  tierId: string | null;
  qualified: boolean;
  qualificationThresholdHours: number;
  created: boolean;
  updated: boolean;
  skipped: boolean;
  skipReason?: string;
}

export interface SlaBatchResult {
  processed: number;
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  results: SlaCalculationResult[];
  errorDetails: string[];
}

function findMatchingTier(
  tiers: GbhetPensionAccrualTier[],
  totalHours: number
): GbhetPensionAccrualTier | null {
  const sorted = [...tiers].sort(
    (a, b) => parseFloat(b.minHours) - parseFloat(a.minHours)
  );
  for (const tier of sorted) {
    if (totalHours >= parseFloat(tier.minHours)) {
      return tier;
    }
  }
  return null;
}

export async function computeSlaForWorkerYear(
  workerId: string,
  year: number,
  planYear: GbhetPensionPlanYear,
  configId: string,
): Promise<SlaCalculationResult> {
  const totalHours = await storage.workerHours.getWorkerYearlyHoursTotal(workerId, year);

  const qualThreshold = parseFloat(planYear.qualificationThresholdHours) || 500;
  const qualified = totalHours >= qualThreshold;

  const tiers = await storage.gbhetPension.accrualTiers.getEffectiveTiersForYear(year);
  if (tiers.length === 0) {
    return {
      workerId, year, totalHours, accrualPct: 0, benefitRate: 0,
      plan: "N/A", amount: "0.00", description: "",
      tierId: null, qualified, qualificationThresholdHours: qualThreshold,
      created: false, updated: false, skipped: true,
      skipReason: "No accrual tiers configured for this year",
    };
  }

  const matchingTier = findMatchingTier(tiers, totalHours);
  if (!matchingTier) {
    return {
      workerId, year, totalHours, accrualPct: 0, benefitRate: 0,
      plan: "N/A", amount: "0.00", description: "",
      tierId: null, qualified, qualificationThresholdHours: qualThreshold,
      created: false, updated: false, skipped: true,
      skipReason: `Hours (${totalHours}) below minimum tier threshold`,
    };
  }

  const accrualPct = parseFloat(matchingTier.accrualPct);

  const worker = await storage.workers.getWorker(workerId);
  if (!worker) {
    return {
      workerId, year, totalHours, accrualPct, benefitRate: 0,
      plan: "N/A", amount: "0.00", description: "",
      tierId: matchingTier.id, qualified, qualificationThresholdHours: qualThreshold,
      created: false, updated: false, skipped: true,
      skipReason: "Worker not found",
    };
  }

  const homeEmployerId = worker.denormHomeEmployerId;
  if (!homeEmployerId) {
    return {
      workerId, year, totalHours, accrualPct, benefitRate: 0,
      plan: "N/A", amount: "0.00", description: "",
      tierId: matchingTier.id, qualified, qualificationThresholdHours: qualThreshold,
      created: false, updated: false, skipped: true,
      skipReason: "Worker has no home employer assigned",
    };
  }

  const employerPlan = await storage.gbhetPension.employerPlans.getByEmployerId(homeEmployerId);
  const plan = employerPlan?.plan || "A";

  const benefitSchedule = await storage.gbhetPension.benefitSchedules.getByYearAndPlan(year, plan);
  if (!benefitSchedule) {
    return {
      workerId, year, totalHours, accrualPct, benefitRate: 0,
      plan, amount: "0.00", description: "",
      tierId: matchingTier.id, qualified, qualificationThresholdHours: qualThreshold,
      created: false, updated: false, skipped: true,
      skipReason: `No benefit schedule found for year ${year}, Plan ${plan}`,
    };
  }

  const benefitRate = parseFloat(benefitSchedule.monthlyBenefitRate);
  const amount = (benefitRate * (accrualPct / 100)).toFixed(2);

  const description = `SLA ${year}: ${totalHours.toLocaleString()} hrs → ${accrualPct}% accrual × $${benefitRate.toFixed(2)} = $${amount}` +
    ` (Plan ${plan})`;

  const chargePluginKey = `sla:${workerId}:${year}`;

  const accountId = await resolveAccountId();
  const ea = await storage.ledger.ea.getOrCreate("worker", workerId, accountId);

  const existingEntry = await storage.ledger.entries.getByChargePluginKey(
    PLUGIN_ID,
    chargePluginKey
  );

  if (existingEntry) {
    const amountChanged = existingEntry.amount !== amount;
    const memoChanged = existingEntry.memo !== description;

    if (!amountChanged && !memoChanged) {
      return {
        workerId, year, totalHours, accrualPct, benefitRate,
        plan, amount, description,
        tierId: matchingTier.id, qualified, qualificationThresholdHours: qualThreshold,
        created: false, updated: false, skipped: true,
        skipReason: "Entry already matches expected values",
      };
    }

    await storage.ledger.entries.update(existingEntry.id, {
      amount,
      memo: description,
      data: {
        pluginId: PLUGIN_ID,
        workerId,
        year,
        totalHours,
        accrualPct,
        benefitRate,
        plan,
        tierId: matchingTier.id,
        qualified,
      },
    });

    return {
      workerId, year, totalHours, accrualPct, benefitRate,
      plan, amount, description,
      tierId: matchingTier.id, qualified, qualificationThresholdHours: qualThreshold,
      created: false, updated: true, skipped: false,
    };
  }

  await storage.ledger.entries.create({
    chargePlugin: PLUGIN_ID,
    chargePluginKey,
    chargePluginConfigId: configId,
    amount,
    eaId: ea.id,
    referenceType: REFERENCE_TYPE,
    referenceId: workerId,
    date: new Date(year, 11, 31),
    memo: description,
    data: {
      pluginId: PLUGIN_ID,
      workerId,
      year,
      totalHours,
      accrualPct,
      benefitRate,
      plan,
      tierId: matchingTier.id,
      qualified,
    },
  });

  return {
    workerId, year, totalHours, accrualPct, benefitRate,
    plan, amount, description,
    tierId: matchingTier.id, qualified, qualificationThresholdHours: qualThreshold,
    created: true, updated: false, skipped: false,
  };
}

export async function computeSlaForWorker(
  workerId: string,
  configId: string,
): Promise<SlaBatchResult & { contributionResult?: ContributionBatchResult; varContribResult?: VarContribReconcileResult }> {
  const result: SlaBatchResult & { contributionResult?: ContributionBatchResult; varContribResult?: VarContribReconcileResult } = {
    processed: 0, created: 0, updated: 0, skipped: 0, errors: 0,
    results: [], errorDetails: [],
  };

  const allPlanYears = await storage.gbhetPension.planYears.getAll();
  const tieredYears = allPlanYears.filter(py => py.accrualMethod === "tiered");

  for (const planYear of tieredYears) {
    try {
      result.processed++;
      const calcResult = await computeSlaForWorkerYear(
        workerId, planYear.year, planYear, configId
      );
      result.results.push(calcResult);
      if (calcResult.created) result.created++;
      else if (calcResult.updated) result.updated++;
      else if (calcResult.skipped) result.skipped++;
    } catch (error) {
      result.errors++;
      const msg = `Error computing SLA for worker ${workerId}, year ${planYear.year}: ${error instanceof Error ? error.message : String(error)}`;
      result.errorDetails.push(msg);
      logger.error(msg, { service: "gbhet-pension-sla" });
    }
  }

  try {
    const contribResult = await reconcileContributionForWorker(workerId, configId);
    result.contributionResult = contribResult;
    result.processed += contribResult.processed;
    result.created += contribResult.created;
    result.updated += contribResult.updated;
    result.skipped += contribResult.skipped;
    result.errors += contribResult.errors;
    result.errorDetails.push(...contribResult.errorDetails);
  } catch (error) {
    const msg = `Error during contribution reconciliation for worker ${workerId}: ${error instanceof Error ? error.message : String(error)}`;
    result.errorDetails.push(msg);
    logger.error(msg, { service: "gbhet-pension-sla" });
  }

  try {
    const varContribResult = await reconcileVariableContributionForWorker(workerId);
    result.varContribResult = varContribResult;
  } catch (error) {
    const msg = `Error during variable contribution reconciliation for worker ${workerId}: ${error instanceof Error ? error.message : String(error)}`;
    result.errorDetails.push(msg);
    logger.error(msg, { service: "gbhet-pension-sla" });
  }

  return result;
}

export interface ContributionReconcileResult {
  triggerEntryId: string;
  year: number;
  sourceAmount: string;
  contributionPct: number;
  slaAmount: string;
  isSpecialDesignation: boolean;
  entityType: string;
  entityId: string;
  workerId: string | null;
  created: boolean;
  updated: boolean;
  skipped: boolean;
  skipReason?: string;
}

export interface ContributionBatchResult {
  processed: number;
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  results: ContributionReconcileResult[];
  errorDetails: string[];
}

const CONTRIBUTION_PLUGIN_ID = "gbhet-pension-sla-contribution";
const CONTRIBUTION_REFERENCE_TYPE = "pension_sla_contribution";

async function resolveWorkerIdFromEntryData(entry: { data: unknown; referenceType: string | null; referenceId: string | null }): Promise<string | null> {
  const data = entry.data as { workerId?: string } | null;
  if (data?.workerId) return data.workerId;
  if ((entry.referenceType === "hour" || entry.referenceType === "hour_adjustment") && entry.referenceId) {
    try {
      const hours = await storage.workerHours.getWorkerHoursById(entry.referenceId);
      return hours?.workerId || null;
    } catch {
      return null;
    }
  }
  return null;
}

async function isSpecialDesignationWorker(
  workerId: string,
  specialDesignationMemberStatusIds: string[]
): Promise<boolean> {
  if (specialDesignationMemberStatusIds.length === 0) return false;
  const worker = await storage.workers.getWorker(workerId);
  if (!worker || !worker.denormMsIds || worker.denormMsIds.length === 0) return false;
  return worker.denormMsIds.some(msId => specialDesignationMemberStatusIds.includes(msId));
}

interface ContributionContext {
  contribYearsByYear: Map<number, GbhetPensionPlanYear>;
  effectiveConfigId: string;
  specialDesignationIds: string[];
  outputAccountId: string;
}

function cleanVariableValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.replace(/^"|"$/g, "").trim() || null;
}

async function resolveContributionContext(): Promise<ContributionContext | null> {
  const triggerVar = await storage.variables.getByName(SLA_TRIGGER_ACCOUNT_VARIABLE);
  const outputVar = await storage.variables.getByName(SLA_ACCOUNT_VARIABLE);
  const triggerAccountId = cleanVariableValue(triggerVar?.value);
  const outputAccountId = cleanVariableValue(outputVar?.value);

  if (!triggerAccountId || !outputAccountId) {
    logger.info("Contribution reconciliation skipped: trigger or output account not configured", {
      service: "gbhet-pension-sla",
    });
    return null;
  }

  const allPlanYears = await storage.gbhetPension.planYears.getAll();
  const contribYears = allPlanYears.filter(py => py.accrualMethod === "contribution_pct");

  if (contribYears.length === 0) {
    return null;
  }

  const contribYearsByYear = new Map(contribYears.map(py => [py.year, py]));

  const pluginConfigs = await storage.chargePluginConfigs.getByPluginId(CONTRIBUTION_PLUGIN_ID);
  const globalConfig = pluginConfigs.find(c => c.scope === "global");

  const effectiveConfigId = globalConfig?.id || "batch";
  const settings = (globalConfig?.settings || {}) as { specialDesignationMemberStatusIds?: string[] };
  const specialDesignationIds = settings.specialDesignationMemberStatusIds || [];

  return { contribYearsByYear, effectiveConfigId, specialDesignationIds, outputAccountId };
}

type RawLedgerEntry = Ledger & { entityType: string; entityId: string };

function filterTriggerEntries(
  entries: RawLedgerEntry[],
  contribYearsByYear: Map<number, GbhetPensionPlanYear>,
  filterWorkerId?: string,
): RawLedgerEntry[] {
  return entries.filter(entry => {
    if (entry.chargePlugin === CONTRIBUTION_PLUGIN_ID) return false;
    const entryDate = entry.date ? new Date(entry.date) : null;
    if (!entryDate) return false;
    const year = entryDate.getFullYear();
    if (!contribYearsByYear.has(year)) return false;
    if (filterWorkerId) {
      const data = entry.data as { workerId?: string } | null;
      if (data?.workerId !== filterWorkerId) return false;
    }
    return true;
  });
}

async function processContributionEntry(
  entry: { id: string; amount: string; date: Date | string | null; chargePlugin: string | null; data: unknown; referenceType: string | null; referenceId: string | null; entityType: string; entityId: string },
  ctx: ContributionContext,
  result: ContributionBatchResult,
): Promise<void> {
  result.processed++;
  try {
    const entryDate = new Date(entry.date!);
    const year = entryDate.getFullYear();
    const planYear = ctx.contribYearsByYear.get(year)!;

    const workerId = await resolveWorkerIdFromEntryData(entry);
    let contributionPct: number;
    let isSpecial = false;

    if (workerId && ctx.specialDesignationIds.length > 0) {
      isSpecial = await isSpecialDesignationWorker(workerId, ctx.specialDesignationIds);
    }

    if (isSpecial) {
      contributionPct = planYear.specialDesignationContributionPct
        ? parseFloat(planYear.specialDesignationContributionPct)
        : (planYear.contributionPct ? parseFloat(planYear.contributionPct) : 0);
    } else {
      contributionPct = planYear.contributionPct ? parseFloat(planYear.contributionPct) : 0;
    }

    if (contributionPct === 0) {
      result.skipped++;
      result.results.push({
        triggerEntryId: entry.id, year, sourceAmount: entry.amount, contributionPct: 0,
        slaAmount: "0.00", isSpecialDesignation: isSpecial,
        entityType: entry.entityType, entityId: entry.entityId, workerId,
        created: false, updated: false, skipped: true, skipReason: "Contribution rate is 0%",
      });
      return;
    }

    const triggerAmount = parseFloat(entry.amount);
    const slaAmount = (triggerAmount * (contributionPct / 100)).toFixed(2);
    const chargePluginKey = `${ctx.effectiveConfigId}:sla-contrib:${entry.id}`;
    const pctLabel = isSpecial ? "special" : "regular";
    const description = `VDB SLA Contribution ${year}: $${entry.amount} × ${contributionPct}% (${pctLabel}) = $${slaAmount}`;

    const existingEntry = await storage.ledger.entries.getByChargePluginKey(
      CONTRIBUTION_PLUGIN_ID,
      chargePluginKey
    );

    if (existingEntry) {
      const amountChanged = existingEntry.amount !== slaAmount;
      const memoChanged = existingEntry.memo !== description;

      if (!amountChanged && !memoChanged) {
        result.skipped++;
        result.results.push({
          triggerEntryId: entry.id, year, sourceAmount: entry.amount, contributionPct,
          slaAmount, isSpecialDesignation: isSpecial,
          entityType: entry.entityType, entityId: entry.entityId, workerId,
          created: false, updated: false, skipped: true, skipReason: "SLA contribution entry already matches",
        });
        return;
      }

      await storage.ledger.entries.update(existingEntry.id, {
        amount: slaAmount,
        memo: description,
        data: {
          pluginId: CONTRIBUTION_PLUGIN_ID, sourceEntryId: entry.id, sourceAmount: entry.amount,
          contributionPct, year, isSpecialDesignation: isSpecial,
          entityType: entry.entityType, entityId: entry.entityId, workerId,
        },
      });

      result.updated++;
      result.results.push({
        triggerEntryId: entry.id, year, sourceAmount: entry.amount, contributionPct,
        slaAmount, isSpecialDesignation: isSpecial,
        entityType: entry.entityType, entityId: entry.entityId, workerId,
        created: false, updated: true, skipped: false,
      });
    } else {
      if (!workerId) {
        result.skipped++;
        result.results.push({
          triggerEntryId: entry.id, year, sourceAmount: entry.amount, contributionPct,
          slaAmount, isSpecialDesignation: isSpecial,
          entityType: entry.entityType, entityId: entry.entityId, workerId,
          created: false, updated: false, skipped: true, skipReason: "Could not resolve worker ID",
        });
        return;
      }

      const ea = await storage.ledger.ea.getOrCreate(
        "worker",
        workerId,
        ctx.outputAccountId
      );

      await storage.ledger.entries.create({
        chargePlugin: CONTRIBUTION_PLUGIN_ID,
        chargePluginKey,
        chargePluginConfigId: ctx.effectiveConfigId,
        amount: slaAmount,
        eaId: ea.id,
        referenceType: CONTRIBUTION_REFERENCE_TYPE,
        referenceId: entry.id,
        date: entryDate,
        memo: description,
        data: {
          pluginId: CONTRIBUTION_PLUGIN_ID, sourceEntryId: entry.id, sourceAmount: entry.amount,
          contributionPct, year, isSpecialDesignation: isSpecial,
          sourceEntityType: entry.entityType, sourceEntityId: entry.entityId, workerId,
        },
      });

      result.created++;
      result.results.push({
        triggerEntryId: entry.id, year, sourceAmount: entry.amount, contributionPct,
        slaAmount, isSpecialDesignation: isSpecial,
        entityType: entry.entityType, entityId: entry.entityId, workerId,
        created: true, updated: false, skipped: false,
      });
    }
  } catch (error) {
    result.errors++;
    const msg = `Error reconciling contribution for trigger entry ${entry.id}: ${error instanceof Error ? error.message : String(error)}`;
    result.errorDetails.push(msg);
    logger.error(msg, { service: "gbhet-pension-sla" });
  }
}

export async function reconcileContributionForWorker(
  workerId: string,
  configId: string,
): Promise<ContributionBatchResult> {
  const result: ContributionBatchResult = {
    processed: 0, created: 0, updated: 0, skipped: 0, errors: 0,
    results: [], errorDetails: [],
  };

  const ctx = await resolveContributionContext();
  if (!ctx) return result;

  const triggerVar = await storage.variables.getByName(SLA_TRIGGER_ACCOUNT_VARIABLE);
  const triggerAccountId = cleanVariableValue(triggerVar?.value);
  if (!triggerAccountId) return result;

  const triggerEntries = await storage.ledger.entries.getRawByAccountId(triggerAccountId);
  const filteredEntries = filterTriggerEntries(triggerEntries, ctx.contribYearsByYear, workerId);

  for (const entry of filteredEntries) {
    await processContributionEntry(entry, ctx, result);
  }

  logger.info("Worker contribution reconciliation completed", {
    service: "gbhet-pension-sla",
    workerId,
    processed: result.processed,
    created: result.created,
    updated: result.updated,
    skipped: result.skipped,
    errors: result.errors,
  });

  return result;
}

export async function reconcileContributionPctYears(
  configId: string,
): Promise<ContributionBatchResult> {
  const result: ContributionBatchResult = {
    processed: 0, created: 0, updated: 0, skipped: 0, errors: 0,
    results: [], errorDetails: [],
  };

  const ctx = await resolveContributionContext();
  if (!ctx) return result;

  const triggerVar = await storage.variables.getByName(SLA_TRIGGER_ACCOUNT_VARIABLE);
  const triggerAccountId = cleanVariableValue(triggerVar?.value);
  if (!triggerAccountId) return result;

  const triggerEntries = await storage.ledger.entries.getRawByAccountId(triggerAccountId);
  const filteredEntries = filterTriggerEntries(triggerEntries, ctx.contribYearsByYear);

  for (const entry of filteredEntries) {
    await processContributionEntry(entry, ctx, result);
  }

  logger.info("Contribution % reconciliation completed", {
    service: "gbhet-pension-sla",
    processed: result.processed,
    created: result.created,
    updated: result.updated,
    skipped: result.skipped,
    errors: result.errors,
  });

  return result;
}

export async function computeSlaForAllWorkers(
  configId: string,
): Promise<SlaBatchResult & { contributionResult?: ContributionBatchResult; varContribResult?: VarContribReconcileResult }> {
  const result: SlaBatchResult & { contributionResult?: ContributionBatchResult; varContribResult?: VarContribReconcileResult } = {
    processed: 0, created: 0, updated: 0, skipped: 0, errors: 0,
    results: [], errorDetails: [],
  };

  const allPlanYears = await storage.gbhetPension.planYears.getAll();
  const tieredYears = allPlanYears.filter(py => py.accrualMethod === "tiered");

  if (tieredYears.length > 0) {
    const allWorkers = await storage.workers.getAllWorkers();

    for (const worker of allWorkers) {
      const workerId = worker.id;
      for (const planYear of tieredYears) {
        try {
          result.processed++;
          const calcResult = await computeSlaForWorkerYear(
            workerId, planYear.year, planYear, configId
          );
          result.results.push(calcResult);
          if (calcResult.created) result.created++;
          else if (calcResult.updated) result.updated++;
          else if (calcResult.skipped) result.skipped++;
        } catch (error) {
          result.errors++;
          const msg = `Error computing SLA for worker ${workerId}, year ${planYear.year}: ${error instanceof Error ? error.message : String(error)}`;
          result.errorDetails.push(msg);
          logger.error(msg, { service: "gbhet-pension-sla" });
        }
      }
    }
  }

  try {
    const contribResult = await reconcileContributionPctYears(configId);
    result.contributionResult = contribResult;
    result.processed += contribResult.processed;
    result.created += contribResult.created;
    result.updated += contribResult.updated;
    result.skipped += contribResult.skipped;
    result.errors += contribResult.errors;
    result.errorDetails.push(...contribResult.errorDetails);
  } catch (error) {
    const msg = `Error during contribution % reconciliation: ${error instanceof Error ? error.message : String(error)}`;
    result.errorDetails.push(msg);
    logger.error(msg, { service: "gbhet-pension-sla" });
  }

  try {
    const varContribResult = await reconcileVariableContributionForAllWorkers();
    result.varContribResult = varContribResult;
  } catch (error) {
    const msg = `Error during variable contribution reconciliation: ${error instanceof Error ? error.message : String(error)}`;
    result.errorDetails.push(msg);
    logger.error(msg, { service: "gbhet-pension-sla" });
  }

  return result;
}

export const SLA_PLUGIN_ID = PLUGIN_ID;

const VAR_CONTRIB_PLUGIN_ID = "gbhet-pension-variable-contribution";
const VAR_CONTRIB_REFERENCE_TYPE = "pension_variable_contribution";
const VAR_CONTRIB_SOURCE_ACCOUNT_VARIABLE = "gbhet_pension_var_contrib_source_account_id";
const VAR_CONTRIB_TARGET_ACCOUNT_VARIABLE = "gbhet_pension_var_contrib_target_account_id";

export interface VarContribReconcileResult {
  processed: number;
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  errorDetails: string[];
}

async function resolveVarContribAccounts(): Promise<{ sourceAccountId: string; targetAccountId: string } | null> {
  const [sourceVar, targetVar] = await Promise.all([
    storage.variables.getByName(VAR_CONTRIB_SOURCE_ACCOUNT_VARIABLE),
    storage.variables.getByName(VAR_CONTRIB_TARGET_ACCOUNT_VARIABLE),
  ]);

  const sourceId = cleanVariableValue(sourceVar?.value);
  const targetId = cleanVariableValue(targetVar?.value);

  if (!sourceId || !targetId) return null;
  return { sourceAccountId: sourceId, targetAccountId: targetId };
}

async function resolveVarContribConfigId(): Promise<string> {
  const pluginConfigs = await storage.chargePluginConfigs.getByPluginId(VAR_CONTRIB_PLUGIN_ID);
  const globalConfig = pluginConfigs.find(c => c.scope === "global");
  return globalConfig?.id || "batch";
}

export async function reconcileVariableContributionForWorker(
  workerId: string,
): Promise<VarContribReconcileResult> {
  const result: VarContribReconcileResult = {
    processed: 0, created: 0, updated: 0, skipped: 0, errors: 0, errorDetails: [],
  };

  const accounts = await resolveVarContribAccounts();
  if (!accounts) {
    logger.info("Variable contribution reconciliation skipped: accounts not configured", {
      service: "gbhet-pension-sla",
    });
    return result;
  }

  const configId = await resolveVarContribConfigId();
  const allPlanYears = await storage.gbhetPension.planYears.getAll();
  const planYearsByYear = new Map(allPlanYears.map(py => [py.year, py]));

  const workerEa = await storage.ledger.ea.getByEntityAndAccount("worker", workerId, accounts.sourceAccountId);
  if (!workerEa) return result;

  const allEntries = await storage.ledger.entries.getByEaId(workerEa.id);
  const slaEntries = allEntries.filter(e =>
    e.chargePlugin === CONTRIBUTION_PLUGIN_ID || e.chargePlugin === PLUGIN_ID
  );

  for (const slaEntry of slaEntries) {
    result.processed++;
    try {
      const entryDate = slaEntry.date ? new Date(slaEntry.date) : null;
      if (!entryDate) {
        result.skipped++;
        continue;
      }
      const year = entryDate.getFullYear();
      const planYear = planYearsByYear.get(year);

      if (!planYear || !planYear.shareValue) {
        result.skipped++;
        continue;
      }

      const shareValue = parseFloat(planYear.shareValue);
      if (shareValue <= 0) {
        result.skipped++;
        continue;
      }

      const slaAmount = parseFloat(slaEntry.amount);
      const shares = slaAmount / shareValue;
      const sharesStr = shares.toFixed(6);

      const chargePluginKey = `${configId}:var-contrib:${slaEntry.id}`;
      const description = `VDB Shares ${year}: $${slaEntry.amount} ÷ $${shareValue.toFixed(2)}/share = ${sharesStr} shares`;

      const existingEntry = await storage.ledger.entries.getByChargePluginKey(
        VAR_CONTRIB_PLUGIN_ID,
        chargePluginKey
      );

      if (existingEntry) {
        const amountChanged = existingEntry.amount !== sharesStr;
        const memoChanged = existingEntry.memo !== description;

        if (!amountChanged && !memoChanged) {
          result.skipped++;
          continue;
        }

        await storage.ledger.entries.update(existingEntry.id, {
          amount: sharesStr,
          memo: description,
          data: {
            pluginId: VAR_CONTRIB_PLUGIN_ID,
            sourceEntryId: slaEntry.id,
            sourceAmount: slaEntry.amount,
            shareValue: planYear.shareValue,
            shares: sharesStr,
            year,
            workerId,
          },
        });
        result.updated++;
      } else {
        const targetEa = await storage.ledger.ea.getOrCreate(
          "worker",
          workerId,
          accounts.targetAccountId
        );

        await storage.ledger.entries.create({
          chargePlugin: VAR_CONTRIB_PLUGIN_ID,
          chargePluginKey,
          chargePluginConfigId: configId,
          amount: sharesStr,
          eaId: targetEa.id,
          referenceType: VAR_CONTRIB_REFERENCE_TYPE,
          referenceId: slaEntry.id,
          date: entryDate,
          memo: description,
          data: {
            pluginId: VAR_CONTRIB_PLUGIN_ID,
            sourceEntryId: slaEntry.id,
            sourceAmount: slaEntry.amount,
            shareValue: planYear.shareValue,
            shares: sharesStr,
            year,
            workerId,
          },
        });
        result.created++;
      }
    } catch (error) {
      result.errors++;
      const msg = `Error reconciling variable contribution for SLA entry ${slaEntry.id}: ${error instanceof Error ? error.message : String(error)}`;
      result.errorDetails.push(msg);
      logger.error(msg, { service: "gbhet-pension-sla" });
    }
  }

  if (result.created > 0 || result.updated > 0) {
    logger.info("Worker variable contribution reconciliation completed", {
      service: "gbhet-pension-sla",
      workerId,
      processed: result.processed,
      created: result.created,
      updated: result.updated,
      skipped: result.skipped,
      errors: result.errors,
    });
  }

  return result;
}

export async function reconcileVariableContributionForAllWorkers(): Promise<VarContribReconcileResult> {
  const result: VarContribReconcileResult = {
    processed: 0, created: 0, updated: 0, skipped: 0, errors: 0, errorDetails: [],
  };

  const accounts = await resolveVarContribAccounts();
  if (!accounts) {
    logger.info("Batch variable contribution reconciliation skipped: accounts not configured", {
      service: "gbhet-pension-sla",
    });
    return result;
  }

  const allWorkers = await storage.workers.getAllWorkers();

  for (const worker of allWorkers) {
    try {
      const workerResult = await reconcileVariableContributionForWorker(worker.id);
      result.processed += workerResult.processed;
      result.created += workerResult.created;
      result.updated += workerResult.updated;
      result.skipped += workerResult.skipped;
      result.errors += workerResult.errors;
      result.errorDetails.push(...workerResult.errorDetails);
    } catch (error) {
      result.errors++;
      const msg = `Error reconciling variable contribution for worker ${worker.id}: ${error instanceof Error ? error.message : String(error)}`;
      result.errorDetails.push(msg);
      logger.error(msg, { service: "gbhet-pension-sla" });
    }
  }

  logger.info("Batch variable contribution reconciliation completed", {
    service: "gbhet-pension-sla",
    processed: result.processed,
    created: result.created,
    updated: result.updated,
    skipped: result.skipped,
    errors: result.errors,
  });

  return result;
}
