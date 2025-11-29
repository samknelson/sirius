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
import type { Ledger, ChargePluginConfig } from "@shared/schema";

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
    configId: string
  ): ExpectedEntry | null {
    if (paymentContext.status !== "cleared") {
      return null;
    }

    const paymentAmount = parseFloat(paymentContext.amount);
    const allocatedAmount = -paymentAmount;
    const transactionDate = paymentContext.dateCleared || new Date();
    
    const description = paymentContext.memo 
      ? `Payment allocation: ${paymentContext.memo}`
      : "Payment allocation";

    return {
      chargePluginKey: `${configId}:${paymentContext.paymentId}:cleared`,
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

      const chargePluginKey = `${config.id}:${paymentContext.paymentId}:cleared`;
      
      const expectedEntry = this.computeExpectedEntry(paymentContext, config.id);
      
      const existingEntry = await storage.ledger.entries.getByChargePluginKey(
        this.metadata.id,
        chargePluginKey
      );

      if (!expectedEntry && !existingEntry) {
        logger.debug("No entry expected and none exists, nothing to do", {
          service: "charge-plugin-payment-simple-allocation",
          paymentId: paymentContext.paymentId,
          status: paymentContext.status,
        });
        return {
          success: true,
          transactions: [],
          message: `Payment status is ${paymentContext.status}, no entry needed`,
        };
      }

      if (!expectedEntry && existingEntry) {
        await storage.ledger.entries.deleteByChargePluginKey(
          this.metadata.id,
          chargePluginKey
        );
        
        logger.info("Deleted ledger entry - payment no longer cleared", {
          service: "charge-plugin-payment-simple-allocation",
          paymentId: paymentContext.paymentId,
          deletedEntryId: existingEntry.id,
          previousAmount: existingEntry.amount,
        });

        const notification: LedgerNotification = {
          type: "deleted",
          amount: existingEntry.amount,
          description: `Ledger entry deleted: -$${Math.abs(parseFloat(existingEntry.amount)).toFixed(2)}`,
        };

        return {
          success: true,
          transactions: [],
          notifications: [notification],
          message: "Deleted ledger entry - payment status changed from cleared",
        };
      }

      if (expectedEntry && !existingEntry) {
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

        logger.info("Creating new ledger entry for cleared payment", {
          service: "charge-plugin-payment-simple-allocation",
          paymentId: paymentContext.paymentId,
          amount: expectedEntry.amount,
        });

        const notification: LedgerNotification = {
          type: "created",
          amount: expectedEntry.amount,
          description: `Ledger entry created: -$${Math.abs(parseFloat(expectedEntry.amount)).toFixed(2)}`,
        };

        return {
          success: true,
          transactions: [transaction],
          notifications: [notification],
          message: `Created entry for $${Math.abs(parseFloat(expectedEntry.amount)).toFixed(2)} allocation`,
        };
      }

      if (expectedEntry && existingEntry) {
        const amountChanged = existingEntry.amount !== expectedEntry.amount;
        const memoChanged = existingEntry.memo !== expectedEntry.description;
        const dateChanged = existingEntry.date?.getTime() !== expectedEntry.transactionDate.getTime();

        if (!amountChanged && !memoChanged && !dateChanged) {
          logger.debug("Ledger entry matches expected state, no update needed", {
            service: "charge-plugin-payment-simple-allocation",
            paymentId: paymentContext.paymentId,
            entryId: existingEntry.id,
          });
          return {
            success: true,
            transactions: [],
            message: "Ledger entry already matches expected state",
          };
        }

        await storage.ledger.entries.update(existingEntry.id, {
          amount: expectedEntry.amount,
          memo: expectedEntry.description,
          date: expectedEntry.transactionDate,
          data: expectedEntry.metadata,
        });

        logger.info("Updated ledger entry to match payment", {
          service: "charge-plugin-payment-simple-allocation",
          paymentId: paymentContext.paymentId,
          entryId: existingEntry.id,
          previousAmount: existingEntry.amount,
          newAmount: expectedEntry.amount,
          amountChanged,
          memoChanged,
          dateChanged,
        });

        const notification: LedgerNotification = {
          type: "updated",
          amount: expectedEntry.amount,
          previousAmount: existingEntry.amount,
          description: amountChanged
            ? `Ledger entry updated: -$${Math.abs(parseFloat(existingEntry.amount)).toFixed(2)} → -$${Math.abs(parseFloat(expectedEntry.amount)).toFixed(2)}`
            : `Ledger entry updated: -$${Math.abs(parseFloat(expectedEntry.amount)).toFixed(2)}`,
        };

        return {
          success: true,
          transactions: [],
          notifications: [notification],
          message: `Updated entry: ${amountChanged ? 'amount' : ''}${memoChanged ? ' memo' : ''}${dateChanged ? ' date' : ''} changed`,
        };
      }

      return {
        success: true,
        transactions: [],
        message: "No action taken",
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
      };

      const expectedEntry = this.computeExpectedEntry(paymentContext, config.id);

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
