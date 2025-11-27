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
  rate: z.number(),
});

const gbhetLegalHourlySettingsSchema = z.object({
  accountId: z.string().uuid("Account ID must be a valid UUID"),
  employmentStatusIds: z.array(z.string()).optional(),
  rateHistory: z.array(rateHistoryEntrySchema).min(1, "At least one rate entry is required"),
});

type GbhetLegalHourlySettings = z.infer<typeof gbhetLegalHourlySettingsSchema>;

interface ExpectedEntry {
  chargePluginKey: string;
  amount: string;
  description: string;
  transactionDate: Date;
  referenceType: string;
  referenceId: string;
  metadata: Record<string, any>;
}

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

  private computeExpectedEntry(
    hoursContext: HoursSavedContext,
    config: any,
    settings: GbhetLegalHourlySettings
  ): ExpectedEntry | null {
    if (settings.employmentStatusIds && settings.employmentStatusIds.length > 0) {
      if (!settings.employmentStatusIds.includes(hoursContext.employmentStatusId)) {
        return null;
      }
    }

    if (hoursContext.hours === 0) {
      return null;
    }

    const hoursDate = new Date(hoursContext.year, hoursContext.month - 1, hoursContext.day);
    const applicableRate = getCurrentEffectiveRate(settings.rateHistory, hoursDate);

    if (!applicableRate) {
      return null;
    }

    if (applicableRate.rate === 0) {
      return null;
    }

    const charge = hoursContext.hours * applicableRate.rate;
    const description = `GBHET Legal: ${hoursContext.hours} hours @ $${applicableRate.rate}/hr`;

    return {
      chargePluginKey: `${config.id}:${hoursContext.hoursId}`,
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
        day: hoursContext.day,
      },
    };
  }

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
      const chargePluginKey = `${config.id}:${hoursContext.hoursId}`;

      const expectedEntry = this.computeExpectedEntry(hoursContext, config, settings);

      const existingEntry = await storage.ledger.entries.getByChargePluginKey(
        this.metadata.id,
        chargePluginKey
      );

      if (!expectedEntry && !existingEntry) {
        logger.debug("No entry expected and none exists, nothing to do", {
          service: "charge-plugin-gbhet-legal-hourly",
          hoursId: hoursContext.hoursId,
          reason: this.getSkipReason(hoursContext, settings),
        });
        return {
          success: true,
          transactions: [],
          message: this.getSkipReason(hoursContext, settings),
        };
      }

      if (!expectedEntry && existingEntry) {
        await storage.ledger.entries.deleteByChargePluginKey(
          this.metadata.id,
          chargePluginKey
        );
        
        logger.info("Deleted ledger entry - hours entry no longer qualifies", {
          service: "charge-plugin-gbhet-legal-hourly",
          hoursId: hoursContext.hoursId,
          deletedEntryId: existingEntry.id,
          previousAmount: existingEntry.amount,
          reason: this.getSkipReason(hoursContext, settings),
        });

        return {
          success: true,
          transactions: [],
          message: `Deleted ledger entry - ${this.getSkipReason(hoursContext, settings)}`,
        };
      }

      if (expectedEntry && !existingEntry) {
        const transaction: LedgerTransaction = {
          chargePlugin: this.metadata.id,
          chargePluginKey: expectedEntry.chargePluginKey,
          accountId: settings.accountId,
          entityType: "worker",
          entityId: hoursContext.workerId,
          amount: expectedEntry.amount,
          description: expectedEntry.description,
          transactionDate: expectedEntry.transactionDate,
          referenceType: expectedEntry.referenceType,
          referenceId: expectedEntry.referenceId,
          metadata: expectedEntry.metadata,
        };

        logger.info("Creating new ledger entry for hours", {
          service: "charge-plugin-gbhet-legal-hourly",
          hoursId: hoursContext.hoursId,
          amount: expectedEntry.amount,
          hours: hoursContext.hours,
          rate: (expectedEntry.metadata as any).rate,
        });

        return {
          success: true,
          transactions: [transaction],
          message: `Created entry for $${expectedEntry.amount} - ${expectedEntry.description}`,
        };
      }

      if (expectedEntry && existingEntry) {
        const amountChanged = existingEntry.amount !== expectedEntry.amount;
        const memoChanged = existingEntry.memo !== expectedEntry.description;
        const dateChanged = existingEntry.date?.getTime() !== expectedEntry.transactionDate.getTime();

        if (!amountChanged && !memoChanged && !dateChanged) {
          logger.debug("Ledger entry matches expected state, no update needed", {
            service: "charge-plugin-gbhet-legal-hourly",
            hoursId: hoursContext.hoursId,
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

        logger.info("Updated ledger entry to match hours", {
          service: "charge-plugin-gbhet-legal-hourly",
          hoursId: hoursContext.hoursId,
          entryId: existingEntry.id,
          previousAmount: existingEntry.amount,
          newAmount: expectedEntry.amount,
          amountChanged,
          memoChanged,
          dateChanged,
        });

        return {
          success: true,
          transactions: [],
          message: `Updated entry: ${amountChanged ? 'amount' : ''}${memoChanged ? ' memo' : ''}${dateChanged ? ' date' : ''} changed`,
        };
      }

      return {
        success: true,
        transactions: [],
        message: "No action taken",
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

  private getSkipReason(hoursContext: HoursSavedContext, settings: GbhetLegalHourlySettings): string {
    if (hoursContext.hours === 0) {
      return "Hours is zero";
    }
    
    if (settings.employmentStatusIds && settings.employmentStatusIds.length > 0) {
      if (!settings.employmentStatusIds.includes(hoursContext.employmentStatusId)) {
        return "Employment status not in configured list";
      }
    }
    
    const hoursDate = new Date(hoursContext.year, hoursContext.month - 1, hoursContext.day);
    const applicableRate = getCurrentEffectiveRate(settings.rateHistory, hoursDate);
    
    if (!applicableRate) {
      return "No applicable rate found for this date";
    }
    
    if (applicableRate.rate === 0) {
      return "Rate is zero";
    }
    
    return "Unknown reason";
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
