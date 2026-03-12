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

// Settings schema for Hour - Fixed plugin
const rateHistoryEntrySchema = z.object({
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format"),
  rate: z.number().positive("Rate must be positive"),
});

const hourFixedSettingsSchema = z.object({
  accountId: z.string().uuid("Account ID must be a valid UUID"),
  chargeTo: z.enum(["worker", "employer"]).default("employer"),
  fixedMonthly: z.boolean().default(false),
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

      // Check employment status filtering
      if (settings.employmentStatusIds && settings.employmentStatusIds.length > 0) {
        if (!settings.employmentStatusIds.includes(hoursContext.employmentStatusId)) {
          logger.debug("Hours entry employment status not in configured list, skipping", {
            service: "charge-plugin-hour-fixed",
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

      // Determine entity type and ID based on chargeTo setting
      const chargeTo = settings.chargeTo || "employer";
      const entityType = chargeTo === "worker" ? "worker" : "employer";
      const entityId = chargeTo === "worker" ? hoursContext.workerId : hoursContext.employerId;

      // Check for existing entries and handle deduplication
      const fixedMonthly = settings.fixedMonthly || false;

      if (fixedMonthly) {
        // For fixed monthly: check if there's already an entry for this month
        const existingMonthlyEntry = await this.findExistingMonthlyEntry(
          settings.accountId,
          entityType,
          entityId,
          hoursContext.year,
          hoursContext.month,
          config.id
        );

        if (existingMonthlyEntry) {
          logger.debug("Fixed monthly charge already exists for this month, skipping", {
            service: "charge-plugin-hour-fixed",
            hoursId: hoursContext.hoursId,
            year: hoursContext.year,
            month: hoursContext.month,
            existingEntryId: existingMonthlyEntry.id,
          });
          return {
            success: true,
            transactions: [],
            message: `Fixed monthly charge already exists for ${hoursContext.year}-${hoursContext.month}`,
          };
        }
      } else {
        // For per-hour: check if there's already an entry for this hours entry
        const existingEntries = await storage.ledger.entries.getByReference("hours", hoursContext.hoursId);
        
        // Filter to only entries from this plugin config
        const existingPluginEntry = existingEntries.find(entry => {
          const data = entry.data as any;
          return data?.pluginConfigId === config.id;
        });

        if (existingPluginEntry) {
          logger.debug("Charge already exists for this hours entry, skipping", {
            service: "charge-plugin-hour-fixed",
            hoursId: hoursContext.hoursId,
            existingEntryId: existingPluginEntry.id,
          });
          return {
            success: true,
            transactions: [],
            message: "Charge already exists for this hours entry",
          };
        }
      }

      // Calculate charge based on fixedMonthly setting
      let charge: number;
      let description: string;

      if (fixedMonthly) {
        // Fixed monthly: use the rate as the total charge for the month
        charge = applicableRate.rate;
        description = `Fixed monthly charge @ $${applicableRate.rate}/month`;
      } else {
        // Per hour: rate * hours
        charge = hoursContext.hours * applicableRate.rate;
        description = `Hours charge: ${hoursContext.hours} hours @ $${applicableRate.rate}/hr`;
      }

      // Create ledger transaction
      const transaction: LedgerTransaction = {
        accountId: settings.accountId,
        entityType,
        entityId,
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
          chargeTo,
          fixedMonthly,
          year: hoursContext.year,
          month: hoursContext.month,
        },
      };

      logger.info("Hour - Fixed plugin executed successfully", {
        service: "charge-plugin-hour-fixed",
        hoursId: hoursContext.hoursId,
        charge,
        rate: applicableRate.rate,
        hours: hoursContext.hours,
        accountId: settings.accountId,
        entityType,
        entityId,
        fixedMonthly,
      });

      return {
        success: true,
        transactions: [transaction],
        message: `Charged $${charge.toFixed(2)} - ${description}`,
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

  /**
   * Find an existing monthly ledger entry for the given account, entity, and month
   * This is used to prevent duplicate fixed monthly charges
   */
  private async findExistingMonthlyEntry(
    accountId: string,
    entityType: string,
    entityId: string,
    year: number,
    month: number,
    pluginConfigId: string
  ): Promise<{ id: string } | null> {
    try {
      // First, find the EA for this account and entity
      const ea = await storage.ledger.ea.getByEntityAndAccount(entityType, entityId, accountId);

      if (!ea) {
        // No EA exists yet, so no existing entries
        logger.debug("No EA found, no existing monthly entry", {
          service: "charge-plugin-hour-fixed",
          accountId,
          entityType,
          entityId,
        });
        return null;
      }

      // Get all ledger entries for this EA
      const allEntries = await storage.ledger.entries.getByEaId(ea.id);
      // Filter to entries with referenceType 'hours'
      const entries = allEntries.filter(e => e.referenceType === "hours");

      logger.debug("Checking for existing monthly entry", {
        service: "charge-plugin-hour-fixed",
        eaId: ea.id,
        entriesCount: entries.length,
        targetYear: year,
        targetMonth: month,
        pluginConfigId,
      });

      // Filter to find entries that match the year/month and plugin config
      for (const entry of entries) {
        const data = entry.data as any;
        // Use Number() to ensure proper type comparison for year/month
        const entryYear = Number(data?.year);
        const entryMonth = Number(data?.month);
        const isFixedMonthly = data?.fixedMonthly === true;
        const entryPluginConfigId = data?.pluginConfigId;

        if (
          entryPluginConfigId === pluginConfigId &&
          entryYear === year &&
          entryMonth === month &&
          isFixedMonthly
        ) {
          logger.debug("Found existing monthly entry", {
            service: "charge-plugin-hour-fixed",
            existingEntryId: entry.id,
            year,
            month,
          });
          return { id: entry.id };
        }
      }

      logger.debug("No existing monthly entry found", {
        service: "charge-plugin-hour-fixed",
        year,
        month,
        pluginConfigId,
      });
      return null;
    } catch (error) {
      logger.error("Failed to check for existing monthly entry", {
        service: "charge-plugin-hour-fixed",
        accountId,
        entityType,
        entityId,
        year,
        month,
        error: error instanceof Error ? error.message : String(error),
      });
      // Return null to allow the charge to proceed (fail open)
      return null;
    }
  }
}

// Register the plugin
registerChargePlugin(new HourFixedPlugin());
