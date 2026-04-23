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
import type { Ledger, ChargePluginConfig } from "@shared/schema";

const PLUGIN_ID = "gbhet-pension-variable-contribution";
const REFERENCE_TYPE = "pension_variable_contribution";
const SLA_CONTRIBUTION_PLUGIN_ID = "gbhet-pension-sla-contribution";
export const VAR_CONTRIB_SOURCE_ACCOUNT_VARIABLE = "gbhet_pension_var_contrib_source_account_id";
export const VAR_CONTRIB_TARGET_ACCOUNT_VARIABLE = "gbhet_pension_var_contrib_target_account_id";

const settingsSchema = z.object({});
type PluginSettings = z.infer<typeof settingsSchema>;

let cachedSourceAccountId: string | null = null;
let cachedTargetAccountId: string | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 60_000;

function cleanVariableValue(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  return raw.replace(/^"|"$/g, "").trim() || null;
}

async function resolveAccounts(): Promise<{ sourceAccountId: string; targetAccountId: string } | null> {
  if (cachedSourceAccountId && cachedTargetAccountId && Date.now() - cacheTimestamp < CACHE_TTL_MS) {
    return { sourceAccountId: cachedSourceAccountId, targetAccountId: cachedTargetAccountId };
  }

  const [sourceVar, targetVar] = await Promise.all([
    storage.variables.getByName(VAR_CONTRIB_SOURCE_ACCOUNT_VARIABLE),
    storage.variables.getByName(VAR_CONTRIB_TARGET_ACCOUNT_VARIABLE),
  ]);

  const sourceId = cleanVariableValue(sourceVar?.value);
  const targetId = cleanVariableValue(targetVar?.value);

  if (!sourceId || !targetId) {
    return null;
  }

  cachedSourceAccountId = sourceId;
  cachedTargetAccountId = targetId;
  cacheTimestamp = Date.now();
  return { sourceAccountId: sourceId, targetAccountId: targetId };
}

export function clearVarContribAccountCache(): void {
  cachedSourceAccountId = null;
  cachedTargetAccountId = null;
  cacheTimestamp = 0;
}

function getPlanYearForDate(date: Date | null): number {
  if (!date) return new Date().getFullYear();
  return date.getFullYear();
}

class GbhetPensionVariableContributionPlugin extends ChargePlugin {
  readonly metadata = {
    id: PLUGIN_ID,
    name: "GBHE Pension Variable Contribution",
    description: "Converts SLA contributions into VDB shares (points) by dividing SLA amount by the start-of-year share value.",
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

    if (ctx.chargePlugin !== SLA_CONTRIBUTION_PLUGIN_ID) {
      return { success: true, transactions: [], message: `Skipping non-SLA entry (plugin: ${ctx.chargePlugin})` };
    }

    try {
      const accounts = await resolveAccounts();
      if (!accounts) {
        return { success: true, transactions: [], message: "Variable contribution accounts not configured, skipping" };
      }

      if (ctx.accountId !== accounts.sourceAccountId) {
        return { success: true, transactions: [], message: "Entry not on source (SLA) account, skipping" };
      }

      if (ctx.entityType !== "worker") {
        return { success: true, transactions: [], message: "Entry not for worker entity, skipping" };
      }

      if (ctx.changeType === "deleted") {
        return this.handleDelete(ctx, config);
      }

      return this.handleCreateOrUpdate(ctx, config, accounts.targetAccountId);
    } catch (error) {
      logger.error("GBHET Pension Variable Contribution plugin execution failed", {
        service: "charge-plugin-gbhet-pension-var-contrib",
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
    targetAccountId: string
  ): Promise<PluginExecutionResult> {
    const year = getPlanYearForDate(ctx.date);
    const allPlanYears = await storage.gbhetPension.planYears.getAll();
    const planYear = allPlanYears.find(py => py.year === year);

    if (!planYear) {
      return {
        success: true,
        transactions: [],
        message: `No plan year found for ${year}, skipping`,
      };
    }

    if (!planYear.shareValue) {
      return {
        success: true,
        transactions: [],
        message: `No share value set for plan year ${year}, skipping`,
      };
    }

    const shareValue = parseFloat(planYear.shareValue);
    if (shareValue <= 0) {
      return {
        success: true,
        transactions: [],
        message: `Share value for ${year} is zero or negative, skipping`,
      };
    }

    const slaAmount = parseFloat(ctx.amount);
    const shares = slaAmount / shareValue;
    const sharesStr = shares.toFixed(6);

    const chargePluginKey = `${config.id}:var-contrib:${ctx.entryId}`;
    const description = `VDB Shares ${year}: $${ctx.amount} ÷ $${shareValue.toFixed(2)}/share = ${sharesStr} shares`;

    const existingEntry = await storage.ledger.entries.getByChargePluginKey(
      PLUGIN_ID,
      chargePluginKey
    );

    if (existingEntry) {
      const amountChanged = existingEntry.amount !== sharesStr;
      const memoChanged = existingEntry.memo !== description;

      if (!amountChanged && !memoChanged) {
        return { success: true, transactions: [], message: "Variable contribution entry already matches" };
      }

      await storage.ledger.entries.update(existingEntry.id, {
        amount: sharesStr,
        memo: description,
        data: {
          pluginId: PLUGIN_ID,
          sourceEntryId: ctx.entryId,
          sourceAmount: ctx.amount,
          shareValue: planYear.shareValue,
          shares: sharesStr,
          year,
          workerId: ctx.entityId,
        },
      });

      return {
        success: true,
        transactions: [],
        notifications: [{
          type: "updated" as const,
          amount: sharesStr,
          previousAmount: existingEntry.amount,
          description: `Variable contribution updated: ${existingEntry.amount} → ${sharesStr} shares`,
        }],
        message: `Updated variable contribution entry`,
      };
    }

    const transaction: LedgerTransaction = {
      chargePlugin: PLUGIN_ID,
      chargePluginKey,
      chargePluginConfigId: config.id,
      accountId: targetAccountId,
      entityType: "worker",
      entityId: ctx.entityId,
      amount: sharesStr,
      description,
      transactionDate: ctx.date || new Date(),
      referenceType: REFERENCE_TYPE,
      referenceId: ctx.entryId,
      metadata: {
        pluginId: PLUGIN_ID,
        sourceEntryId: ctx.entryId,
        sourceAmount: ctx.amount,
        shareValue: planYear.shareValue,
        shares: sharesStr,
        year,
        workerId: ctx.entityId,
      },
    };

    logger.info("Creating variable contribution entry", {
      service: "charge-plugin-gbhet-pension-var-contrib",
      sourceEntryId: ctx.entryId,
      slaAmount: ctx.amount,
      shareValue: planYear.shareValue,
      shares: sharesStr,
      year,
    });

    return {
      success: true,
      transactions: [transaction],
      notifications: [{
        type: "created" as const,
        amount: sharesStr,
        description: `Variable contribution created: ${sharesStr} shares`,
      }],
      message: `Created variable contribution entry for ${sharesStr} shares`,
    };
  }

  private async handleDelete(
    ctx: LedgerEntrySavedContext,
    config: ChargePluginConfig
  ): Promise<PluginExecutionResult> {
    const chargePluginKey = `${config.id}:var-contrib:${ctx.entryId}`;
    const existingEntry = await storage.ledger.entries.getByChargePluginKey(
      PLUGIN_ID,
      chargePluginKey
    );

    if (!existingEntry) {
      return { success: true, transactions: [], message: "No variable contribution entry to delete" };
    }

    await storage.ledger.entries.deleteByChargePluginKey(PLUGIN_ID, chargePluginKey);

    return {
      success: true,
      transactions: [],
      notifications: [{
        type: "deleted" as const,
        amount: existingEntry.amount,
        description: `Variable contribution deleted: -${existingEntry.amount} shares`,
      }],
      message: `Deleted variable contribution entry`,
    };
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
        shareValue?: string;
        year?: number;
      } | null;

      if (!data?.sourceAmount || !data?.shareValue) {
        return {
          ...baseResult,
          isValid: false,
          discrepancies: ["Missing required metadata (sourceAmount, shareValue)"],
        };
      }

      const shareValue = parseFloat(data.shareValue);
      if (shareValue <= 0) {
        return {
          ...baseResult,
          isValid: false,
          discrepancies: ["Share value is zero or negative in metadata"],
        };
      }

      const expectedShares = (parseFloat(data.sourceAmount) / shareValue).toFixed(6);
      const discrepancies: string[] = [];

      if (entry.amount !== expectedShares) {
        discrepancies.push(`Shares mismatch: expected ${expectedShares}, found ${entry.amount}`);
      }

      return {
        ...baseResult,
        isValid: discrepancies.length === 0,
        expectedAmount: expectedShares,
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

registerChargePlugin(new GbhetPensionVariableContributionPlugin());
