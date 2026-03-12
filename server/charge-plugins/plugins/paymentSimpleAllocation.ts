import { ChargePlugin } from "../base";
import { 
  TriggerType, 
  PluginContext, 
  PluginExecutionResult, 
  PaymentSavedContext,
  LedgerTransaction,
  LedgerNotification,
  LedgerEntryVerification,
} from "../types";
import { registerChargePlugin } from "../registry";
import { z } from "zod";
import { logger } from "../../logger";
import { storage } from "../../storage";
import { createUnifiedOptionsStorage } from "../../storage/unified-options";
import type { Ledger, ChargePluginConfig } from "@shared/schema";
import { getCurrency } from "@shared/currency";

const unifiedOptionsStorage = createUnifiedOptionsStorage();

const paymentSimpleAllocationSettingsSchema = z.object({
  accountIds: z.array(z.string().uuid("Account ID must be a valid UUID")).min(1, "At least one account is required"),
});

type PaymentSimpleAllocationSettings = z.infer<typeof paymentSimpleAllocationSettingsSchema>;

interface ExpectedEntry {
  chargePluginKey: string;
  amount: string;
  description: string;
  transactionDate: Date;
  eaId: string;
  referenceType: string;
  referenceId: string;
  metadata: Record<string, any>;
}

class PaymentSimpleAllocationPlugin extends ChargePlugin {
  readonly metadata = {
    id: "payment-simple-allocation",
    name: "Payment Simple Allocation",
    description: "Automatically creates ledger entries when payments are saved. Only applies to payments on configured accounts.",
    triggers: [TriggerType.PAYMENT_SAVED],
    defaultScope: "global" as const,
    settingsSchema: paymentSimpleAllocationSettingsSchema,
  };

  private computeExpectedEntry(
    paymentContext: PaymentSavedContext,
    configId: string,
    currencyLabel: string,
    paymentTypeName: string
  ): ExpectedEntry | null {
    if (paymentContext.status !== "cleared") {
      return null;
    }

    const paymentAmount = parseFloat(paymentContext.amount);
    const allocatedAmount = -paymentAmount;
    const transactionDate = paymentContext.dateCleared || new Date();
    
    const description = `${currencyLabel} Adjustment: ${paymentTypeName}`;

    return {
      chargePluginKey: `${configId}:${paymentContext.paymentId}`,
      amount: allocatedAmount.toFixed(2),
      description,
      transactionDate,
      eaId: paymentContext.ledgerEaId,
      referenceType: "payment",
      referenceId: paymentContext.paymentId,
      metadata: {
        pluginId: this.metadata.id,
        pluginConfigId: configId,
        paymentId: paymentContext.paymentId,
        originalAmount: paymentContext.amount,
        ledgerEaId: paymentContext.ledgerEaId,
      },
    };
  }

  async execute(
    context: PluginContext,
    config: any
  ): Promise<PluginExecutionResult> {
    if (context.trigger !== TriggerType.PAYMENT_SAVED) {
      return {
        success: false,
        transactions: [],
        error: `Payment Simple Allocation plugin only handles PAYMENT_SAVED trigger, got ${context.trigger}`,
      };
    }

    const paymentContext = context as PaymentSavedContext;

    try {
      const validationResult = this.validateSettings(config.settings);
      if (!validationResult.valid) {
        logger.error("Invalid settings for Payment Simple Allocation plugin", {
          service: "charge-plugin-payment-simple-allocation",
          errors: validationResult.errors,
          configId: config.id,
        });
        return {
          success: false,
          transactions: [],
          error: `Invalid plugin settings: ${validationResult.errors?.join(", ")}`,
        };
      }

      const settings = config.settings as PaymentSimpleAllocationSettings;

      if (!settings.accountIds.includes(paymentContext.accountId)) {
        logger.debug("Payment account not in configured list, skipping", {
          service: "charge-plugin-payment-simple-allocation",
          paymentId: paymentContext.paymentId,
          accountId: paymentContext.accountId,
          configuredAccounts: settings.accountIds,
        });
        return {
          success: true,
          transactions: [],
          message: "Payment account not in configured list",
        };
      }

      // Look up payment type and currency for description
      const paymentType = await unifiedOptionsStorage.get("ledger-payment-type", paymentContext.paymentTypeId);
      const paymentTypeName = paymentType?.name || "Unknown";
      const currencyCode = paymentType?.currencyCode || "USD";
      const currency = getCurrency(currencyCode);
      const currencyLabel = currency?.label || currencyCode;

      const expectedEntry = this.computeExpectedEntry(paymentContext, config.id, currencyLabel, paymentTypeName);
      
      // Find ALL existing entries for this payment + config combination
      // This catches entries with any chargePluginKey format (including legacy formats)
      const existingEntries = await storage.ledger.entries.getByReferenceAndConfig(
        paymentContext.paymentId,
        config.id
      );
      
      // Filter to only entries from this plugin
      const ourEntries = existingEntries.filter(e => e.chargePlugin === this.metadata.id);
      
      // Delete all stale entries first
      const notifications: LedgerNotification[] = [];
      for (const staleEntry of ourEntries) {
        await storage.ledger.entries.delete(staleEntry.id);
        logger.info("Deleted stale ledger entry", {
          service: "charge-plugin-payment-simple-allocation",
          paymentId: paymentContext.paymentId,
          deletedEntryId: staleEntry.id,
          previousAmount: staleEntry.amount,
          previousKey: staleEntry.chargePluginKey,
        });
      }

      // If no entry is expected, we're done (already deleted any stale entries)
      if (!expectedEntry) {
        if (ourEntries.length > 0) {
          const totalDeleted = ourEntries.reduce((sum, e) => sum + Math.abs(parseFloat(e.amount)), 0);
          notifications.push({
            type: "deleted",
            amount: (-totalDeleted).toFixed(2),
            description: `Deleted ${ourEntries.length} ledger entry(s): -$${totalDeleted.toFixed(2)}`,
          });
        }
        
        logger.debug("No entry expected for payment", {
          service: "charge-plugin-payment-simple-allocation",
          paymentId: paymentContext.paymentId,
          status: paymentContext.status,
          deletedCount: ourEntries.length,
        });
        
        return {
          success: true,
          transactions: [],
          notifications,
          message: ourEntries.length > 0 
            ? `Deleted ${ourEntries.length} stale entry(s) - payment status is ${paymentContext.status}`
            : `Payment status is ${paymentContext.status}, no entry needed`,
        };
      }

      // Create the new entry with the correct key format
      const transaction: LedgerTransaction = {
        chargePlugin: this.metadata.id,
        chargePluginKey: expectedEntry.chargePluginKey,
        chargePluginConfigId: config.id,
        accountId: paymentContext.accountId,
        entityType: paymentContext.entityType,
        entityId: paymentContext.entityId,
        amount: expectedEntry.amount,
        description: expectedEntry.description,
        transactionDate: expectedEntry.transactionDate,
        referenceType: expectedEntry.referenceType,
        referenceId: expectedEntry.referenceId,
        metadata: expectedEntry.metadata,
      };

      const actionType = ourEntries.length > 0 ? "recreated" : "created";
      logger.info(`${actionType} ledger entry for cleared payment`, {
        service: "charge-plugin-payment-simple-allocation",
        paymentId: paymentContext.paymentId,
        amount: expectedEntry.amount,
        deletedStaleCount: ourEntries.length,
      });

      notifications.push({
        type: ourEntries.length > 0 ? "updated" : "created",
        amount: expectedEntry.amount,
        description: ourEntries.length > 0
          ? `Ledger entry updated: -$${Math.abs(parseFloat(expectedEntry.amount)).toFixed(2)}`
          : `Ledger entry created: -$${Math.abs(parseFloat(expectedEntry.amount)).toFixed(2)}`,
      });

      return {
        success: true,
        transactions: [transaction],
        notifications,
        message: ourEntries.length > 0
          ? `Replaced ${ourEntries.length} stale entry(s) with correct entry`
          : `Created entry for $${Math.abs(parseFloat(expectedEntry.amount)).toFixed(2)} allocation`,
      };

    } catch (error) {
      logger.error("Payment Simple Allocation plugin execution failed", {
        service: "charge-plugin-payment-simple-allocation",
        paymentId: paymentContext.paymentId,
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

      const settings = config.settings as PaymentSimpleAllocationSettings;

      if (!entry.referenceId) {
        return {
          ...baseResult,
          isValid: false,
          discrepancies: ["Entry has no referenceId - cannot verify"],
        };
      }

      const payment = await storage.ledger.payments.get(entry.referenceId);
      
      if (!payment) {
        return {
          ...baseResult,
          isValid: false,
          discrepancies: [`Referenced payment ${entry.referenceId} no longer exists - orphaned entry`],
        };
      }

      const ea = await storage.ledger.ea.get(payment.ledgerEaId);
      if (!ea) {
        return {
          ...baseResult,
          isValid: false,
          discrepancies: [`Payment's EA ${payment.ledgerEaId} no longer exists`],
        };
      }

      if (!settings.accountIds.includes(ea.accountId)) {
        return {
          ...baseResult,
          isValid: false,
          discrepancies: [`Payment account ${ea.accountId} is not in the configured account list - entry should not exist`],
        };
      }

      const paymentContext: PaymentSavedContext = {
        trigger: TriggerType.PAYMENT_SAVED,
        paymentId: payment.id,
        amount: payment.amount,
        status: payment.status,
        ledgerEaId: payment.ledgerEaId,
        accountId: ea.accountId,
        entityType: ea.entityType,
        entityId: ea.entityId,
        dateCleared: payment.dateCleared,
        memo: payment.memo,
        paymentTypeId: payment.paymentType,
      };

      // Look up payment type and currency for description
      const verifyPaymentType = await unifiedOptionsStorage.get("ledger-payment-type", payment.paymentType);
      const verifyPaymentTypeName = verifyPaymentType?.name || "Unknown";
      const verifyCurrencyCode = verifyPaymentType?.currencyCode || "USD";
      const verifyCurrency = getCurrency(verifyCurrencyCode);
      const verifyCurrencyLabel = verifyCurrency?.label || verifyCurrencyCode;

      const expectedEntry = this.computeExpectedEntry(paymentContext, config.id, verifyCurrencyLabel, verifyPaymentTypeName);

      if (!expectedEntry) {
        return {
          ...baseResult,
          isValid: false,
          expectedAmount: "0.00",
          expectedDescription: null,
          discrepancies: [`Entry exists but payment status is "${payment.status}" (not "cleared") - entry should be deleted`],
        };
      }

      const discrepancies: string[] = [];

      if (entry.amount !== expectedEntry.amount) {
        discrepancies.push(`Amount mismatch: expected ${expectedEntry.amount}, found ${entry.amount}`);
      }

      if (entry.memo !== expectedEntry.description) {
        discrepancies.push(`Description mismatch: expected "${expectedEntry.description}", found "${entry.memo}"`);
      }

      return {
        ...baseResult,
        isValid: discrepancies.length === 0,
        expectedAmount: expectedEntry.amount,
        expectedDescription: expectedEntry.description,
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

registerChargePlugin(new PaymentSimpleAllocationPlugin());
