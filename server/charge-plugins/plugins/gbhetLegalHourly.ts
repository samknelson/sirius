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
import { storage } from "../../storage/database";
import { isComponentEnabled } from "../../modules/components";

const rateHistoryEntrySchema = z.object({
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format"),
  rate: z.number().positive("Rate must be positive"),
});

const gbhetLegalHourlySettingsSchema = z.object({
  accountId: z.string().uuid("Account ID must be a valid UUID"),
  employmentStatusIds: z.array(z.string()).optional(),
  rateHistory: z.array(rateHistoryEntrySchema).min(1, "At least one rate entry is required"),
});

type GbhetLegalHourlySettings = z.infer<typeof gbhetLegalHourlySettingsSchema>;

class GbhetLegalHourlyPlugin extends ChargePlugin {
  readonly metadata = {
    id: "gbhet-legal-hourly",
    name: "GBHET Legal Hourly",
    description: "Charges an hourly rate for GBHET Legal benefits based on worker hours.",
    triggers: [TriggerType.HOURS_SAVED],
    defaultScope: "global" as const,
    settingsSchema: gbhetLegalHourlySettingsSchema,
    requiredComponent: "sitespecific.gbhet.legal",
  };

  async execute(
    context: PluginContext,
    config: any
  ): Promise<PluginExecutionResult> {
    if (context.trigger !== TriggerType.HOURS_SAVED) {
      return {
        success: false,
        transactions: [],
        error: `GBHET Legal Hourly plugin only handles HOURS_SAVED trigger, got ${context.trigger}`,
      };
    }

    const hoursContext = context as HoursSavedContext;

    try {
      const validationResult = this.validateSettings(config.settings);
      if (!validationResult.valid) {
        logger.error("Invalid settings for GBHET Legal Hourly plugin", {
          service: "charge-plugin-gbhet-legal-hourly",
          errors: validationResult.errors,
          configId: config.id,
        });
        return {
          success: false,
          transactions: [],
          error: `Invalid plugin settings: ${validationResult.errors?.join(", ")}`,
        };
      }

      const settings = config.settings as GbhetLegalHourlySettings;

      if (settings.employmentStatusIds && settings.employmentStatusIds.length > 0) {
        if (!settings.employmentStatusIds.includes(hoursContext.employmentStatusId)) {
          logger.debug("Hours entry employment status not in configured list, skipping", {
            service: "charge-plugin-gbhet-legal-hourly",
            hoursId: hoursContext.hoursId,
            employmentStatusId: hoursContext.employmentStatusId,
            configuredStatuses: settings.employmentStatusIds,
          });
          return {
            success: true,
            transactions: [],
            message: "Employment status not in configured list",
          };
        }
      }

      const hoursDate = new Date(hoursContext.year, hoursContext.month - 1, hoursContext.day);
      const applicableRate = getCurrentEffectiveRate(settings.rateHistory, hoursDate);

      if (!applicableRate) {
        logger.warn("No applicable rate found for hours entry", {
          service: "charge-plugin-gbhet-legal-hourly",
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

      // Duplicate prevention is now handled by the unique constraint on (charge_plugin, charge_plugin_key)
      // The executor will catch any duplicate key violations and log them without failing

      const charge = hoursContext.hours * applicableRate.rate;
      const description = `GBHET Legal: ${hoursContext.hours} hours @ $${applicableRate.rate}/hr`;

      const transaction: LedgerTransaction = {
        chargePlugin: this.metadata.id,
        chargePluginKey: `${config.id}:${hoursContext.hoursId}`,
        accountId: settings.accountId,
        entityType: "worker",
        entityId: hoursContext.workerId,
        amount: charge.toFixed(2),
        description,
        transactionDate: hoursDate,
        referenceType: "hours",
        referenceId: hoursContext.hoursId,
        metadata: {
          pluginId: this.metadata.id,
          pluginConfigId: config.id,
          workerId: hoursContext.workerId,
          employerId: hoursContext.employerId,
          hours: hoursContext.hours,
          rate: applicableRate.rate,
          effectiveDate: applicableRate.effectiveDate,
          year: hoursContext.year,
          month: hoursContext.month,
        },
      };

      logger.info("GBHET Legal Hourly plugin executed successfully", {
        service: "charge-plugin-gbhet-legal-hourly",
        hoursId: hoursContext.hoursId,
        charge,
        rate: applicableRate.rate,
        hours: hoursContext.hours,
        accountId: settings.accountId,
        workerId: hoursContext.workerId,
      });

      return {
        success: true,
        transactions: [transaction],
        message: `Charged $${charge.toFixed(2)} - ${description}`,
      };

    } catch (error) {
      logger.error("GBHET Legal Hourly plugin execution failed", {
        service: "charge-plugin-gbhet-legal-hourly",
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

async function registerIfComponentEnabled() {
  const isEnabled = await isComponentEnabled("sitespecific.gbhet.legal");
  if (isEnabled) {
    registerChargePlugin(new GbhetLegalHourlyPlugin());
  } else {
    logger.debug("GBHET Legal Hourly plugin not registered - component sitespecific.gbhet.legal is not enabled", {
      service: "charge-plugin-gbhet-legal-hourly",
    });
  }
}

registerIfComponentEnabled().catch(error => {
  logger.error("Failed to check component status for GBHET Legal Hourly plugin", {
    service: "charge-plugin-gbhet-legal-hourly",
    error: error instanceof Error ? error.message : String(error),
  });
});
