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
import { z } from "zod";
import { logger } from "../../logger";
import { storage } from "../../storage";
import type { Ledger, ChargePluginConfig } from "@shared/schema";

const btuDuesAllocationSettingsSchema = z.object({
  accountIds: z.array(z.string().uuid("Account ID must be a valid UUID")).min(1, "At least one account is required"),
});

type BtuDuesAllocationSettings = z.infer<typeof btuDuesAllocationSettingsSchema>;

class BtuDuesAllocationPlugin extends ChargePlugin {
  readonly metadata = {
    id: "btu-dues-allocation",
    name: "BTU Dues Allocation",
    description: "Creates ledger entries when dues are imported via the BTU Dues Allocation wizard. Only applies to configured accounts.",
    triggers: [TriggerType.DUES_IMPORT_SAVED],
    defaultScope: "global" as const,
    settingsSchema: btuDuesAllocationSettingsSchema,
    requiredComponent: "sitespecific.btu",
  };

  async execute(
    context: PluginContext,
    config: any
  ): Promise<PluginExecutionResult> {
    if (context.trigger !== TriggerType.DUES_IMPORT_SAVED) {
      return {
        success: false,
        transactions: [],
        error: `BTU Dues Allocation plugin only handles DUES_IMPORT_SAVED trigger, got ${context.trigger}`,
      };
    }

    const duesContext = context as DuesImportSavedContext;

    try {
      const validationResult = this.validateSettings(config.settings);
      if (!validationResult.valid) {
        logger.error("Invalid settings for BTU Dues Allocation plugin", {
          service: "charge-plugin-btu-dues-allocation",
          errors: validationResult.errors,
          configId: config.id,
        });
        return {
          success: false,
          transactions: [],
          error: `Invalid plugin settings: ${validationResult.errors?.join(", ")}`,
        };
      }

      const settings = config.settings as BtuDuesAllocationSettings;

      if (!settings.accountIds.includes(duesContext.accountId)) {
        logger.debug("Dues account not in configured list, skipping", {
          service: "charge-plugin-btu-dues-allocation",
          wizardId: duesContext.wizardId,
          accountId: duesContext.accountId,
          configuredAccounts: settings.accountIds,
        });
        return {
          success: true,
          transactions: [],
          message: "Dues account not in configured list",
        };
      }

      const chargePluginKey = `${config.id}:${duesContext.wizardId}:${duesContext.rowIndex}`;
      const amount = parseFloat(duesContext.amount);
      const allocatedAmount = -amount;

      const description = `Dues Deduction: ${duesContext.workerName}`;

      const existingEntry = await storage.ledger.entries.getByChargePluginKey(this.metadata.id, chargePluginKey);
      
      const notifications: LedgerNotification[] = [];
      if (existingEntry) {
        await storage.ledger.entries.delete(existingEntry.id);
        logger.info("Deleted stale dues ledger entry", {
          service: "charge-plugin-btu-dues-allocation",
          wizardId: duesContext.wizardId,
          deletedEntryId: existingEntry.id,
          previousAmount: existingEntry.amount,
        });
      }

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
        referenceType: "dues_import",
        referenceId: duesContext.wizardId,
        metadata: {
          pluginId: this.metadata.id,
          pluginConfigId: config.id,
          wizardId: duesContext.wizardId,
          rowIndex: duesContext.rowIndex,
          bpsEmployeeId: duesContext.bpsEmployeeId,
          deductionCode: duesContext.deductionCode,
          originalAmount: duesContext.amount,
        },
      };

      const actionType = existingEntry ? "recreated" : "created";
      logger.info(`${actionType} ledger entry for dues import`, {
        service: "charge-plugin-btu-dues-allocation",
        wizardId: duesContext.wizardId,
        workerId: duesContext.workerId,
        amount: allocatedAmount.toFixed(2),
      });

      notifications.push({
        type: existingEntry ? "updated" : "created",
        amount: allocatedAmount.toFixed(2),
        description: existingEntry
          ? `Dues entry updated: -$${Math.abs(allocatedAmount).toFixed(2)}`
          : `Dues entry created: -$${Math.abs(allocatedAmount).toFixed(2)}`,
      });

      return {
        success: true,
        transactions: [transaction],
        notifications,
        message: `Created dues entry for ${duesContext.workerName}`,
      };

    } catch (error) {
      logger.error("BTU Dues Allocation plugin execution failed", {
        service: "charge-plugin-btu-dues-allocation",
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

registerChargePlugin(new BtuDuesAllocationPlugin());
