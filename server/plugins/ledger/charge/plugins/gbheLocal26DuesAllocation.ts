import { ChargePlugin } from "../base";
import {
  TriggerType,
  PluginContext,
  PluginExecutionResult,
  DuesImportSavedContext,
  LedgerTransaction,
  LedgerNotification,
  LedgerEntryVerification,
} from "../types";
import { registerChargePlugin } from "../registry";
import type { ChargePluginMetadata } from "../types";
import { z } from "zod";
import { logger } from "../../../../logger";
import { storage } from "../../../../storage";
import type { Ledger, ChargePluginConfig } from "@shared/schema";

// The ledger account this plugin watches is a first-class column on
// charge_plugin_configs (config.account); the plugin keeps no settings.
const gbheLocal26DuesAllocationSettingsSchema = z.object({});

type GbheLocal26DuesAllocationSettings = z.infer<typeof gbheLocal26DuesAllocationSettingsSchema>;

class GbheLocal26DuesAllocationPlugin extends ChargePlugin {
  readonly metadata: ChargePluginMetadata = {
    id: "gbhe-local26-dues-allocation",
    name: "GBHE Local 26 Dues Allocation",
    description:
      "Creates weekly dues-withheld ledger entries when dues are imported via the GBHE Local 26 Hourly wizard. One entry per worker per reporting week, on the configured account, with the worker as the EA.",
    triggers: [TriggerType.DUES_IMPORT_SAVED],
    defaultScope: "global" as const,
    configSchema: {
      type: "object",
      properties: {},
    },
    requiredComponent: "sitespecific.gbhet",
  };

  async execute(
    context: PluginContext,
    config: any
  ): Promise<PluginExecutionResult> {
    if (context.trigger !== TriggerType.DUES_IMPORT_SAVED) {
      return {
        success: false,
        transactions: [],
        error: `GBHE Local 26 Dues Allocation plugin only handles DUES_IMPORT_SAVED trigger, got ${context.trigger}`,
      };
    }

    const duesContext = context as DuesImportSavedContext;

    try {
      const validationResult = this.validateSettings(config.settings);
      if (!validationResult.valid) {
        logger.error("Invalid settings for GBHE Local 26 Dues Allocation plugin", {
          service: "charge-plugin-gbhe-local26-dues-allocation",
          errors: validationResult.errors,
          configId: config.id,
        });
        return {
          success: false,
          transactions: [],
          error: `Invalid plugin settings: ${validationResult.errors?.join(", ")}`,
        };
      }

      // No account configured => plugin is inert (produces no new entries).
      if (!config.account) {
        return {
          success: true,
          transactions: [],
          message: "No ledger account configured for this charge plugin",
        };
      }

      if (config.account !== duesContext.accountId) {
        logger.debug("Dues account does not match configured account, skipping", {
          service: "charge-plugin-gbhe-local26-dues-allocation",
          wizardId: duesContext.wizardId,
          accountId: duesContext.accountId,
          configuredAccount: config.account,
        });
        return {
          success: true,
          transactions: [],
          message: "Dues account does not match configured account",
        };
      }

      // Weekly dues events must carry the reporting week's statement date;
      // fail loudly instead of writing entries with an ambiguous week.
      if (!duesContext.weekYmd) {
        return {
          success: false,
          transactions: [],
          error: "Dues import event is missing the reporting week date (weekYmd) required for weekly dues allocation",
        };
      }

      const weekYmd = duesContext.weekYmd;
      // Deterministic per config + worker + reporting week: one entry per
      // worker per week regardless of which wizard run or file row produced
      // it. Re-uploads (new wizard id) resolve to the SAME key, so corrected
      // amounts replace the stale entry instead of duplicating it.
      const chargePluginKey = `${config.id}:${duesContext.workerId}:${weekYmd}`;
      const amount = parseFloat(duesContext.amount);
      const allocatedAmount = -amount;

      const employerName = duesContext.withholdingEmployerName || null;
      const description = employerName
        ? `Dues Withheld: ${duesContext.workerName} — withheld by ${employerName}`
        : `Dues Withheld: ${duesContext.workerName}`;

      const existingEntry = await storage.ledger.entries.getByChargePluginKey(this.metadata.id, chargePluginKey);

      // Identical amount for the same worker/week is a pure re-run: keep the
      // existing entry untouched instead of delete/recreate churn.
      if (existingEntry && existingEntry.amount === allocatedAmount.toFixed(2)) {
        logger.info("Skipping duplicate dues entry - identical entry already exists for this worker and week", {
          service: "charge-plugin-gbhe-local26-dues-allocation",
          wizardId: duesContext.wizardId,
          workerId: duesContext.workerId,
          accountId: duesContext.accountId,
          configId: config.id,
          weekYmd,
          existingEntryId: existingEntry.id,
          existingAmount: existingEntry.amount,
        });
        return {
          success: true,
          skippedDuplicate: true,
          transactions: [],
          notifications: [{
            type: "skipped" as any,
            amount: allocatedAmount.toFixed(2),
            description: `Skipped: identical entry already exists for ${duesContext.workerName} for week ${weekYmd} ($${existingEntry.amount})`,
          }],
          message: `Skipped duplicate: identical entry already exists for ${duesContext.workerName} for week ${weekYmd}`,
        };
      }

      // A differing amount for the same worker/week is a correction. Update
      // the existing row IN PLACE (single UPDATE) rather than delete +
      // recreate: the executor's later insert is soft-fail, so deleting here
      // could leave the worker/week with no entry if the insert failed.
      if (existingEntry) {
        const updated = await storage.ledger.entries.update(existingEntry.id, {
          amount: allocatedAmount.toFixed(2),
          memo: description,
          date: duesContext.transactionDate,
          statementYmd: weekYmd,
          referenceType: "dues_import",
          referenceId: duesContext.wizardId,
          data: {
            pluginId: this.metadata.id,
            pluginConfigId: config.id,
            wizardId: duesContext.wizardId,
            rowIndex: duesContext.rowIndex,
            weekYmd,
            withholdingEmployerId: duesContext.withholdingEmployerId ?? null,
            withholdingEmployerName: employerName,
            deductionCode: duesContext.deductionCode,
            originalAmount: duesContext.amount,
          },
        });
        if (!updated) {
          // Entry vanished between read and update (concurrent change).
          // Fail loudly; the next re-run will create it fresh.
          return {
            success: false,
            transactions: [],
            error: `Failed to update existing dues entry ${existingEntry.id} for ${duesContext.workerName} (week ${weekYmd}); re-run the import`,
          };
        }
        logger.info("Updated stale dues ledger entry in place", {
          service: "charge-plugin-gbhe-local26-dues-allocation",
          wizardId: duesContext.wizardId,
          entryId: existingEntry.id,
          previousAmount: existingEntry.amount,
          newAmount: allocatedAmount.toFixed(2),
          weekYmd,
        });
        return {
          success: true,
          transactions: [],
          notifications: [{
            type: "updated",
            amount: allocatedAmount.toFixed(2),
            previousAmount: existingEntry.amount,
            description: `Dues entry updated: -$${Math.abs(allocatedAmount).toFixed(2)} (week ${weekYmd})`,
          }],
          message: `Updated dues entry for ${duesContext.workerName} (week ${weekYmd})`,
        };
      }

      const notifications: LedgerNotification[] = [];

      const transaction: LedgerTransaction = {
        chargePlugin: this.metadata.id,
        chargePluginKey,
        chargePluginConfigId: config.id,
        accountId: duesContext.accountId,
        entityType: "worker",
        entityId: duesContext.workerId,
        amount: allocatedAmount.toFixed(2),
        description,
        transactionDate: duesContext.transactionDate,
        statementYmd: weekYmd,
        referenceType: "dues_import",
        referenceId: duesContext.wizardId,
        metadata: {
          pluginId: this.metadata.id,
          pluginConfigId: config.id,
          wizardId: duesContext.wizardId,
          rowIndex: duesContext.rowIndex,
          weekYmd,
          withholdingEmployerId: duesContext.withholdingEmployerId ?? null,
          withholdingEmployerName: employerName,
          deductionCode: duesContext.deductionCode,
          originalAmount: duesContext.amount,
        },
      };

      logger.info("created ledger entry for weekly dues import", {
        service: "charge-plugin-gbhe-local26-dues-allocation",
        wizardId: duesContext.wizardId,
        workerId: duesContext.workerId,
        weekYmd,
        amount: allocatedAmount.toFixed(2),
      });

      notifications.push({
        type: "created",
        amount: allocatedAmount.toFixed(2),
        description: `Dues entry created: -$${Math.abs(allocatedAmount).toFixed(2)} (week ${weekYmd})`,
      });

      return {
        success: true,
        transactions: [transaction],
        notifications,
        message: `Created dues entry for ${duesContext.workerName} (week ${weekYmd})`,
      };

    } catch (error) {
      logger.error("GBHE Local 26 Dues Allocation plugin execution failed", {
        service: "charge-plugin-gbhe-local26-dues-allocation",
        wizardId: duesContext.wizardId,
        workerId: duesContext.workerId,
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        success: false,
        transactions: [],
        error: error instanceof Error ? error.message : "Unknown error occurred",
      };
    }
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
      const validationResult = this.validateSettings(config.settings);
      if (!validationResult.valid) {
        return {
          ...baseResult,
          isValid: false,
          discrepancies: [`Invalid plugin configuration: ${validationResult.errors?.join(", ")}`],
        };
      }

      if (!entry.referenceId) {
        return {
          ...baseResult,
          isValid: false,
          discrepancies: ["Entry has no referenceId (wizardId) - cannot verify"],
        };
      }

      const wizard = await storage.wizards.getById(entry.referenceId);
      if (!wizard) {
        return {
          ...baseResult,
          isValid: false,
          discrepancies: [`Referenced wizard ${entry.referenceId} no longer exists`],
        };
      }

      return baseResult;

    } catch (error) {
      return {
        ...baseResult,
        isValid: false,
        discrepancies: [`Verification error: ${error instanceof Error ? error.message : String(error)}`],
      };
    }
  }
}

registerChargePlugin(new GbheLocal26DuesAllocationPlugin());
