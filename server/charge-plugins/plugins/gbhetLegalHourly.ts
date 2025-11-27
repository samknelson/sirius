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
  eaId: string;
  referenceType: string;
  referenceId: string;
  metadata: Record<string, any>;
}

class GbhetLegalHourlyPlugin extends ChargePlugin {
  readonly metadata = {
    id: "gbhet-legal-hourly",
    name: "GBHET Legal Hourly",
    description: "Charges a monthly rate for GBHET Legal benefits when there are qualifying hours in a month.",
    triggers: [TriggerType.HOURS_SAVED],
    defaultScope: "global" as const,
    settingsSchema: gbhetLegalHourlySettingsSchema,
    requiredComponent: "sitespecific.gbhet.legal",
  };

  private async computeExpectedEntry(
    hoursContext: HoursSavedContext,
    config: any,
    settings: GbhetLegalHourlySettings
  ): Promise<ExpectedEntry | null> {
    const totalHours = await storage.workers.getMonthlyHoursTotal(
      hoursContext.workerId,
      hoursContext.employerId,
      hoursContext.year,
      hoursContext.month,
      settings.employmentStatusIds && settings.employmentStatusIds.length > 0 
        ? settings.employmentStatusIds 
        : undefined
    );

    if (totalHours <= 0) {
      return null;
    }

    const monthDate = new Date(hoursContext.year, hoursContext.month - 1, 1);
    const applicableRate = getCurrentEffectiveRate(settings.rateHistory, monthDate);

    if (!applicableRate) {
      return null;
    }

    if (applicableRate.rate === 0) {
      return null;
    }

    const ea = await storage.ledger.ea.getOrCreate(
      "worker",
      hoursContext.workerId,
      settings.accountId
    );

    const chargePluginKey = `${config.id}:${ea.id}:${hoursContext.workerId}:${hoursContext.year}:${hoursContext.month}`;
    const monthName = monthDate.toLocaleString('default', { month: 'long' });
    const description = `GBHET Legal: ${monthName} ${hoursContext.year} (${totalHours} qualifying hours)`;

    return {
      chargePluginKey,
      amount: applicableRate.rate.toFixed(2),
      description,
      transactionDate: monthDate,
      eaId: ea.id,
      referenceType: "hour",
      referenceId: `${hoursContext.workerId}:${hoursContext.employerId}:${hoursContext.year}:${hoursContext.month}`,
      metadata: {
        pluginId: this.metadata.id,
        pluginConfigId: config.id,
        workerId: hoursContext.workerId,
        employerId: hoursContext.employerId,
        year: hoursContext.year,
        month: hoursContext.month,
        totalHours,
        rate: applicableRate.rate,
        effectiveDate: applicableRate.effectiveDate,
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

      const ea = await storage.ledger.ea.getOrCreate(
        "worker",
        hoursContext.workerId,
        settings.accountId
      );

      const chargePluginKey = `${config.id}:${ea.id}:${hoursContext.workerId}:${hoursContext.year}:${hoursContext.month}`;

      const expectedEntry = await this.computeExpectedEntry(hoursContext, config, settings);

      const existingEntry = await storage.ledger.entries.getByChargePluginKey(
        this.metadata.id,
        chargePluginKey
      );

      if (!expectedEntry && !existingEntry) {
        logger.debug("No entry expected and none exists, nothing to do", {
          service: "charge-plugin-gbhet-legal-hourly",
          hoursId: hoursContext.hoursId,
          reason: "No qualifying hours in month",
        });
        return {
          success: true,
          transactions: [],
          message: "No qualifying hours in month",
        };
      }

      if (!expectedEntry && existingEntry) {
        await storage.ledger.entries.deleteByChargePluginKey(
          this.metadata.id,
          chargePluginKey
        );
        
        logger.info("Deleted ledger entry - no longer qualifying hours in month", {
          service: "charge-plugin-gbhet-legal-hourly",
          hoursId: hoursContext.hoursId,
          deletedEntryId: existingEntry.id,
          previousAmount: existingEntry.amount,
          workerId: hoursContext.workerId,
          year: hoursContext.year,
          month: hoursContext.month,
        });

        return {
          success: true,
          transactions: [],
          message: "Deleted ledger entry - no longer qualifying hours in month",
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

        logger.info("Creating new monthly ledger entry", {
          service: "charge-plugin-gbhet-legal-hourly",
          hoursId: hoursContext.hoursId,
          amount: expectedEntry.amount,
          workerId: hoursContext.workerId,
          year: hoursContext.year,
          month: hoursContext.month,
          totalHours: (expectedEntry.metadata as any).totalHours,
        });

        return {
          success: true,
          transactions: [transaction],
          message: `Created monthly entry for $${expectedEntry.amount} - ${expectedEntry.description}`,
        };
      }

      if (expectedEntry && existingEntry) {
        const amountChanged = existingEntry.amount !== expectedEntry.amount;
        const memoChanged = existingEntry.memo !== expectedEntry.description;

        if (!amountChanged && !memoChanged) {
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
          data: expectedEntry.metadata,
        });

        logger.info("Updated monthly ledger entry", {
          service: "charge-plugin-gbhet-legal-hourly",
          hoursId: hoursContext.hoursId,
          entryId: existingEntry.id,
          previousAmount: existingEntry.amount,
          newAmount: expectedEntry.amount,
          amountChanged,
          memoChanged,
        });

        return {
          success: true,
          transactions: [],
          message: `Updated entry: ${amountChanged ? 'amount' : ''}${memoChanged ? ' memo' : ''} changed`,
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
