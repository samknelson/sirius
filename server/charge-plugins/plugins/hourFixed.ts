import { ChargePlugin } from "../base";
import { 
  TriggerType, 
  PluginContext, 
  PluginExecutionResult, 
  HoursSavedContext,
  LedgerTransaction,
} from "../types";
import { registerChargePlugin } from "../registry";
import { z } from "zod";
import { logger } from "../../logger";
import { getCurrentEffectiveRate } from "../../utils/rateHistory";

// Settings schema for Hour - Fixed plugin
const rateHistoryEntrySchema = z.object({
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format"),
  rate: z.number().positive("Rate must be positive"),
});

const hourFixedSettingsSchema = z.object({
  accountId: z.string().uuid("Account ID must be a valid UUID"),
  employmentStatusIds: z.array(z.string()).optional(),
  rateHistory: z.array(rateHistoryEntrySchema).min(1, "At least one rate entry is required"),
});

type HourFixedSettings = z.infer<typeof hourFixedSettingsSchema>;
type RateHistoryEntry = z.infer<typeof rateHistoryEntrySchema>;

class HourFixedPlugin extends ChargePlugin {
  readonly metadata = {
    id: "hour-fixed",
    name: "Hour - Fixed Rate",
    description: "Charges a fixed hourly rate based on rate history. When hours are saved, creates a ledger transaction.",
    triggers: [TriggerType.HOURS_SAVED],
    defaultScope: "global" as const,
    settingsSchema: hourFixedSettingsSchema,
  };

  async execute(
    context: PluginContext,
    config: any
  ): Promise<PluginExecutionResult> {
    if (context.trigger !== TriggerType.HOURS_SAVED) {
      return {
        success: false,
        transactions: [],
        error: `Hour - Fixed plugin only handles HOURS_SAVED trigger, got ${context.trigger}`,
      };
    }

    const hoursContext = context as HoursSavedContext;

    try {
      // Validate settings
      const validationResult = this.validateSettings(config.settings);
      if (!validationResult.valid) {
        logger.error("Invalid settings for Hour - Fixed plugin", {
          service: "charge-plugin-hour-fixed",
          errors: validationResult.errors,
          configId: config.id,
        });
        return {
          success: false,
          transactions: [],
          error: `Invalid plugin settings: ${validationResult.errors?.join(", ")}`,
        };
      }

      const settings = config.settings as HourFixedSettings;

      // Find applicable rate for the hours date
      const hoursDate = new Date(hoursContext.year, hoursContext.month - 1, hoursContext.day);
      const applicableRate = getCurrentEffectiveRate(settings.rateHistory, hoursDate);

      if (!applicableRate) {
        logger.warn("No applicable rate found for hours entry", {
          service: "charge-plugin-hour-fixed",
          hoursId: hoursContext.hoursId,
          hoursDate: hoursDate.toISOString(),
          configId: config.id,
        });
        return {
          success: true,
          transactions: [],
          message: "No applicable rate found for this date",
        };
      }

      // Calculate charge
      const charge = hoursContext.hours * applicableRate.rate;

      // Create ledger transaction
      const transaction: LedgerTransaction = {
        accountId: settings.accountId,
        entityType: "employer",
        entityId: hoursContext.employerId,
        amount: charge.toFixed(2),
        description: `Hours charge: ${hoursContext.hours} hours @ $${applicableRate.rate}/hr`,
        transactionDate: hoursDate,
        referenceType: "worker_hours",
        referenceId: hoursContext.hoursId,
        metadata: {
          pluginId: this.metadata.id,
          pluginConfigId: config.id,
          workerId: hoursContext.workerId,
          hours: hoursContext.hours,
          rate: applicableRate.rate,
          effectiveDate: applicableRate.effectiveDate,
        },
      };

      logger.info("Hour - Fixed plugin executed successfully", {
        service: "charge-plugin-hour-fixed",
        hoursId: hoursContext.hoursId,
        charge,
        rate: applicableRate.rate,
        hours: hoursContext.hours,
        accountId: settings.accountId,
      });

      return {
        success: true,
        transactions: [transaction],
        message: `Charged $${charge.toFixed(2)} for ${hoursContext.hours} hours @ $${applicableRate.rate}/hr`,
      };

    } catch (error) {
      logger.error("Hour - Fixed plugin execution failed", {
        service: "charge-plugin-hour-fixed",
        hoursId: hoursContext.hoursId,
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

// Register the plugin
registerChargePlugin(new HourFixedPlugin());
