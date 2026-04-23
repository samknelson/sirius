import { ChargePlugin } from "../base";
import {
  TriggerType,
  PluginContext,
  PluginExecutionResult,
  LedgerEntrySavedContext,
  LedgerTransaction,
  LedgerEntryVerification,
} from "../types";
import { registerChargePlugin } from "../registry";
import { z } from "zod";
import { logger } from "../../logger";
import { storage } from "../../storage/database";
import { SLA_TRIGGER_ACCOUNT_VARIABLE, SLA_ACCOUNT_VARIABLE } from "../../services/gbhet-pension-sla";
import type { Ledger, ChargePluginConfig } from "@shared/schema";

const PLUGIN_ID = "gbhet-pension-sla-contribution";
const REFERENCE_TYPE = "pension_sla_contribution";

const settingsSchema = z.object({
  specialDesignationMemberStatusIds: z.array(z.string()).optional(),
});

type PluginSettings = z.infer<typeof settingsSchema>;

let cachedTriggerAccountId: string | null = null;
let cachedOutputAccountId: string | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 60_000;

async function resolveAccounts(): Promise<{ triggerAccountId: string; outputAccountId: string } | null> {
  if (cachedTriggerAccountId && cachedOutputAccountId && Date.now() - cacheTimestamp < CACHE_TTL_MS) {
    return { triggerAccountId: cachedTriggerAccountId, outputAccountId: cachedOutputAccountId };
  }

  const [triggerVar, outputVar] = await Promise.all([
    storage.variables.getByName(SLA_TRIGGER_ACCOUNT_VARIABLE),
    storage.variables.getByName(SLA_ACCOUNT_VARIABLE),
  ]);

  const rawTrigger = triggerVar?.value as string | null;
  const rawOutput = outputVar?.value as string | null;
  const triggerId = typeof rawTrigger === "string" ? rawTrigger.replace(/^"|"$/g, "").trim() : null;
  const outputId = typeof rawOutput === "string" ? rawOutput.replace(/^"|"$/g, "").trim() : null;

  if (!triggerId || !outputId) {
    return null;
  }

  cachedTriggerAccountId = triggerId;
  cachedOutputAccountId = outputId;
  cacheTimestamp = Date.now();
  return { triggerAccountId: triggerId, outputAccountId: outputId };
}

async function isSpecialDesignation(
  workerId: string,
  settings: PluginSettings
): Promise<boolean> {
  if (!settings.specialDesignationMemberStatusIds || settings.specialDesignationMemberStatusIds.length === 0) {
    return false;
  }
  const worker = await storage.workers.getWorker(workerId);
  if (!worker || !worker.denormMsIds || worker.denormMsIds.length === 0) {
    return false;
  }
  return worker.denormMsIds.some(msId => settings.specialDesignationMemberStatusIds!.includes(msId));
}

function getPlanYearForDate(date: Date | null): number {
  if (!date) return new Date().getFullYear();
  return date.getFullYear();
}

class GbhetPensionSlaContributionPlugin extends ChargePlugin {
  readonly metadata = {
    id: PLUGIN_ID,
    name: "GBHE Pension SLA Contribution",
    description: "Computes SLA contributions at plan year contribution % when entries are written to the trigger account.",
    triggers: [TriggerType.LEDGER_ENTRY_SAVED],
    defaultScope: "global" as const,
    settingsSchema,
    requiredComponent: "sitespecific.gbhet.pension",
  };

  async execute(
    context: PluginContext,
    config: ChargePluginConfig
  ): Promise<PluginExecutionResult> {
    if (context.trigger !== TriggerType.LEDGER_ENTRY_SAVED) {
      return { success: false, transactions: [], error: `Wrong trigger type: ${context.trigger}` };
    }

    const ctx = context as LedgerEntrySavedContext;

    if (ctx.chargePlugin === PLUGIN_ID) {
      return { success: true, transactions: [], message: "Skipping self-triggered entry" };
    }

    try {
      const accounts = await resolveAccounts();
      if (!accounts) {
        return { success: true, transactions: [], message: "SLA accounts not configured, skipping" };
      }

      if (ctx.accountId !== accounts.triggerAccountId) {
        return { success: true, transactions: [], message: "Entry not on trigger account, skipping" };
      }

      if (ctx.entityType !== "employer") {
        return { success: true, transactions: [], message: "Entry not for employer entity, skipping" };
      }

      if (ctx.changeType === "deleted") {
        return this.handleDelete(ctx, config);
      }

      return this.handleCreateOrUpdate(ctx, config, accounts.outputAccountId);
    } catch (error) {
      logger.error("GBHET Pension SLA Contribution plugin execution failed", {
        service: "charge-plugin-gbhet-pension-sla-contrib",
        entryId: ctx.entryId,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        transactions: [],
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  private async handleCreateOrUpdate(
    ctx: LedgerEntrySavedContext,
    config: ChargePluginConfig,
    outputAccountId: string
  ): Promise<PluginExecutionResult> {
    const year = getPlanYearForDate(ctx.date);
    const allPlanYears = await storage.gbhetPension.planYears.getAll();
    const planYear = allPlanYears.find(py => py.year === year && py.accrualMethod === "contribution_pct");

    if (!planYear) {
      return {
        success: true,
        transactions: [],
        message: `No contribution_pct plan year found for ${year}, skipping`,
      };
    }

    const settings = (config.settings || {}) as PluginSettings;
    const workerId = await this.resolveWorkerIdFromEmployerEntry(ctx);
    let contributionPct: number;

    if (workerId && await isSpecialDesignation(workerId, settings)) {
      contributionPct = planYear.specialDesignationContributionPct
        ? parseFloat(planYear.specialDesignationContributionPct)
        : (planYear.contributionPct ? parseFloat(planYear.contributionPct) : 0);
    } else {
      contributionPct = planYear.contributionPct ? parseFloat(planYear.contributionPct) : 0;
    }

    if (contributionPct === 0) {
      return { success: true, transactions: [], message: "Contribution rate is 0%, skipping" };
    }

    const triggerAmount = parseFloat(ctx.amount);
    const slaAmount = (triggerAmount * (contributionPct / 100)).toFixed(2);
    const chargePluginKey = `${config.id}:sla-contrib:${ctx.entryId}`;

    const isSpecial = workerId ? await isSpecialDesignation(workerId, settings) : false;
    const pctLabel = isSpecial ? "special" : "regular";
    const description = `VDB SLA Contribution ${year}: $${ctx.amount} × ${contributionPct}% (${pctLabel}) = $${slaAmount}`;

    const existingEntry = await storage.ledger.entries.getByChargePluginKey(
      PLUGIN_ID,
      chargePluginKey
    );

    if (existingEntry) {
      const amountChanged = existingEntry.amount !== slaAmount;
      const memoChanged = existingEntry.memo !== description;

      if (!amountChanged && !memoChanged) {
        return { success: true, transactions: [], message: "SLA contribution entry already matches" };
      }

      await storage.ledger.entries.update(existingEntry.id, {
        amount: slaAmount,
        memo: description,
        data: {
          pluginId: PLUGIN_ID,
          sourceEntryId: ctx.entryId,
          sourceAmount: ctx.amount,
          contributionPct,
          year,
          isSpecialDesignation: isSpecial,
          entityType: ctx.entityType,
          entityId: ctx.entityId,
          workerId,
        },
      });

      return {
        success: true,
        transactions: [],
        notifications: [{
          type: "updated" as const,
          amount: slaAmount,
          previousAmount: existingEntry.amount,
          description: `SLA contribution updated: $${existingEntry.amount} → $${slaAmount}`,
        }],
        message: `Updated SLA contribution entry`,
      };
    }

    if (!workerId) {
      return { success: true, transactions: [], message: "Could not resolve worker ID from entry, skipping" };
    }

    const transaction: LedgerTransaction = {
      chargePlugin: PLUGIN_ID,
      chargePluginKey,
      chargePluginConfigId: config.id,
      accountId: outputAccountId,
      entityType: "worker",
      entityId: workerId,
      amount: slaAmount,
      description,
      transactionDate: ctx.date || new Date(),
      referenceType: REFERENCE_TYPE,
      referenceId: ctx.entryId,
      metadata: {
        pluginId: PLUGIN_ID,
        sourceEntryId: ctx.entryId,
        sourceAmount: ctx.amount,
        contributionPct,
        year,
        isSpecialDesignation: isSpecial,
        sourceEntityType: ctx.entityType,
        sourceEntityId: ctx.entityId,
        workerId,
      },
    };

    logger.info("Creating SLA contribution entry", {
      service: "charge-plugin-gbhet-pension-sla-contrib",
      sourceEntryId: ctx.entryId,
      amount: slaAmount,
      contributionPct,
      year,
    });

    return {
      success: true,
      transactions: [transaction],
      notifications: [{
        type: "created" as const,
        amount: slaAmount,
        description: `SLA contribution created: $${slaAmount}`,
      }],
      message: `Created SLA contribution entry for $${slaAmount}`,
    };
  }

  private async handleDelete(
    ctx: LedgerEntrySavedContext,
    config: ChargePluginConfig
  ): Promise<PluginExecutionResult> {
    const chargePluginKey = `${config.id}:sla-contrib:${ctx.entryId}`;
    const existingEntry = await storage.ledger.entries.getByChargePluginKey(
      PLUGIN_ID,
      chargePluginKey
    );

    if (!existingEntry) {
      return { success: true, transactions: [], message: "No SLA contribution entry to delete" };
    }

    await storage.ledger.entries.deleteByChargePluginKey(PLUGIN_ID, chargePluginKey);

    return {
      success: true,
      transactions: [],
      notifications: [{
        type: "deleted" as const,
        amount: existingEntry.amount,
        description: `SLA contribution deleted: -$${existingEntry.amount}`,
      }],
      message: `Deleted SLA contribution entry`,
    };
  }

  private async resolveWorkerIdFromEmployerEntry(ctx: LedgerEntrySavedContext): Promise<string | null> {
    const data = ctx.data as { workerId?: string } | null;
    if (data?.workerId) {
      return data.workerId;
    }
    if ((ctx.referenceType === "hour" || ctx.referenceType === "hour_adjustment") && ctx.referenceId) {
      try {
        const hours = await storage.workerHours.getWorkerHoursById(ctx.referenceId);
        return hours?.workerId || null;
      } catch {
        return null;
      }
    }
    return null;
  }

  async verifyEntry(
    entry: Ledger,
    config: ChargePluginConfig
  ): Promise<LedgerEntryVerification> {
    const baseResult: LedgerEntryVerification = {
      entryId: entry.id,
      chargePlugin: entry.chargePlugin,
      chargePluginKey: entry.chargePluginKey,
      isValid: true,
      discrepancies: [],
      actualAmount: entry.amount,
      expectedAmount: null,
      actualDescription: entry.memo,
      expectedDescription: null,
      referenceType: entry.referenceType,
      referenceId: entry.referenceId,
      transactionDate: entry.date,
    };

    try {
      const data = entry.data as {
        sourceEntryId?: string;
        sourceAmount?: string;
        contributionPct?: number;
        year?: number;
      } | null;

      if (!data?.sourceEntryId || !data?.sourceAmount || !data?.contributionPct) {
        return {
          ...baseResult,
          isValid: false,
          discrepancies: ["Missing required metadata (sourceEntryId, sourceAmount, contributionPct)"],
        };
      }

      const expectedAmount = (parseFloat(data.sourceAmount) * (data.contributionPct / 100)).toFixed(2);
      const discrepancies: string[] = [];

      if (entry.amount !== expectedAmount) {
        discrepancies.push(`Amount mismatch: expected ${expectedAmount}, found ${entry.amount}`);
      }

      return {
        ...baseResult,
        isValid: discrepancies.length === 0,
        expectedAmount,
        discrepancies,
      };
    } catch (error) {
      return {
        ...baseResult,
        isValid: false,
        discrepancies: [`Verification error: ${error instanceof Error ? error.message : String(error)}`],
      };
    }
  }
}

registerChargePlugin(new GbhetPensionSlaContributionPlugin());
