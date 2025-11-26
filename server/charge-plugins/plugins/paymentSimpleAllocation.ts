import { ChargePlugin } from "../base";
import { 
  TriggerType, 
  PluginContext, 
  PluginExecutionResult, 
  PaymentSavedContext,
  LedgerTransaction,
} from "../types";
import { registerChargePlugin } from "../registry";
import { z } from "zod";
import { logger } from "../../logger";

const paymentSimpleAllocationSettingsSchema = z.object({
  accountIds: z.array(z.string().uuid("Account ID must be a valid UUID")).min(1, "At least one account is required"),
});

type PaymentSimpleAllocationSettings = z.infer<typeof paymentSimpleAllocationSettingsSchema>;

class PaymentSimpleAllocationPlugin extends ChargePlugin {
  readonly metadata = {
    id: "payment-simple-allocation",
    name: "Payment Simple Allocation",
    description: "Automatically creates ledger entries when payments are saved. Only applies to payments on configured accounts.",
    triggers: [TriggerType.PAYMENT_SAVED],
    defaultScope: "global" as const,
    settingsSchema: paymentSimpleAllocationSettingsSchema,
  };

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

      if (paymentContext.status !== "cleared") {
        logger.debug("Payment status is not cleared, skipping", {
          service: "charge-plugin-payment-simple-allocation",
          paymentId: paymentContext.paymentId,
          status: paymentContext.status,
        });
        return {
          success: true,
          transactions: [],
          message: `Payment status is ${paymentContext.status}, not cleared`,
        };
      }

      const paymentAmount = parseFloat(paymentContext.amount);
      const allocatedAmount = -paymentAmount;
      const transactionDate = paymentContext.dateCleared || new Date();
      
      const description = paymentContext.memo 
        ? `Payment allocation: ${paymentContext.memo}`
        : "Payment allocation";

      const transaction: LedgerTransaction = {
        chargePlugin: this.metadata.id,
        chargePluginKey: `${config.id}:${paymentContext.paymentId}`,
        accountId: paymentContext.accountId,
        entityType: paymentContext.entityType,
        entityId: paymentContext.entityId,
        amount: allocatedAmount.toFixed(2),
        description,
        transactionDate,
        referenceType: "payment",
        referenceId: paymentContext.paymentId,
        metadata: {
          pluginId: this.metadata.id,
          pluginConfigId: config.id,
          paymentId: paymentContext.paymentId,
          originalAmount: paymentContext.amount,
          ledgerEaId: paymentContext.ledgerEaId,
        },
      };

      logger.info("Payment Simple Allocation plugin executed successfully", {
        service: "charge-plugin-payment-simple-allocation",
        paymentId: paymentContext.paymentId,
        allocatedAmount,
        accountId: paymentContext.accountId,
        entityType: paymentContext.entityType,
        entityId: paymentContext.entityId,
      });

      return {
        success: true,
        transactions: [transaction],
        message: `Allocated $${Math.abs(allocatedAmount).toFixed(2)} from payment`,
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
}

registerChargePlugin(new PaymentSimpleAllocationPlugin());
