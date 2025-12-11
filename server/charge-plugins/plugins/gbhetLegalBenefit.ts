import { ChargePlugin } from "../base";
import { 
  TriggerType, 
  PluginContext, 
  PluginExecutionResult, 
  WmbSavedContext,
  LedgerTransaction,
  LedgerNotification,
  LedgerEntryVerification,
} from "../types";
import { registerChargePlugin } from "../registry";
import { z } from "zod";
import { logger } from "../../logger";
import { getCurrentEffectiveRate } from "../../utils/rateHistory";
import { storage } from "../../storage/database";
import type { Ledger, ChargePluginConfig } from "@shared/schema";

const rateHistoryEntrySchema = z.object({
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format"),
  rate: z.number(),
});

const gbhetLegalBenefitSettingsSchema = z.object({
  accountId: z.string().uuid("Account ID must be a valid UUID"),
  benefitId: z.string().uuid("Benefit ID must be a valid UUID"),
  rateHistory: z.array(rateHistoryEntrySchema).min(1, "At least one rate entry is required"),
});

type GbhetLegalBenefitSettings = z.infer<typeof gbhetLegalBenefitSettingsSchema>;

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

class GbhetLegalBenefitPlugin extends ChargePlugin {
  readonly metadata = {
    id: "gbhet-legal-benefit",
    name: "GBHET Legal Benefit",
    description: "Charges a monthly rate for GBHET Legal benefits when a worker has the configured benefit in a given month.",
    triggers: [TriggerType.WMB_SAVED],
    defaultScope: "global" as const,
    settingsSchema: gbhetLegalBenefitSettingsSchema,
    requiredComponent: "sitespecific.gbhet.legal",
  };

  private async computeExpectedEntry(
    wmbContext: WmbSavedContext,
    config: any,
    settings: GbhetLegalBenefitSettings
  ): Promise<ExpectedEntry | null> {
    if (wmbContext.benefitId !== settings.benefitId) {
      return null;
    }

    if (wmbContext.isDeleted) {
      return null;
    }

    const monthStartDate = new Date(wmbContext.year, wmbContext.month - 1, 1);
    const lastDayOfMonth = new Date(wmbContext.year, wmbContext.month, 0);
    const applicableRate = getCurrentEffectiveRate(settings.rateHistory, monthStartDate);

    if (!applicableRate) {
      return null;
    }

    if (applicableRate.rate === 0) {
      return null;
    }

    const ea = await storage.ledger.ea.getOrCreate(
      "employer",
      wmbContext.employerId,
      settings.accountId
    );

    const chargePluginKey = `${config.id}:${ea.id}:${wmbContext.workerId}:${wmbContext.year}:${wmbContext.month}`;
    const monthName = monthStartDate.toLocaleString('default', { month: 'long' });
    const description = `GBHET Legal: ${monthName} ${wmbContext.year}`;

    return {
      chargePluginKey,
      amount: applicableRate.rate.toFixed(2),
      description,
      transactionDate: lastDayOfMonth,
      eaId: ea.id,
      referenceType: "wmb",
      referenceId: wmbContext.wmbId,
      metadata: {
        pluginId: this.metadata.id,
        pluginConfigId: config.id,
        workerId: wmbContext.workerId,
        employerId: wmbContext.employerId,
        benefitId: wmbContext.benefitId,
        year: wmbContext.year,
        month: wmbContext.month,
        rate: applicableRate.rate,
        effectiveDate: applicableRate.effectiveDate,
      },
    };
  }

  async execute(
    context: PluginContext,
    config: any
  ): Promise<PluginExecutionResult> {
    if (context.trigger !== TriggerType.WMB_SAVED) {
      return {
        success: false,
        transactions: [],
        error: `GBHET Legal Benefit plugin only handles WMB_SAVED trigger, got ${context.trigger}`,
      };
    }

    const wmbContext = context as WmbSavedContext;

    try {
      const validationResult = this.validateSettings(config.settings);
      if (!validationResult.valid) {
        logger.error("Invalid settings for GBHET Legal Benefit plugin", {
          service: "charge-plugin-gbhet-legal-benefit",
          errors: validationResult.errors,
          configId: config.id,
        });
        return {
          success: false,
          transactions: [],
          error: `Invalid plugin settings: ${validationResult.errors?.join(", ")}`,
        };
      }

      const settings = config.settings as GbhetLegalBenefitSettings;

      if (wmbContext.benefitId !== settings.benefitId) {
        logger.debug("WMB benefit does not match configured benefit, skipping", {
          service: "charge-plugin-gbhet-legal-benefit",
          wmbId: wmbContext.wmbId,
          wmbBenefitId: wmbContext.benefitId,
          configuredBenefitId: settings.benefitId,
        });
        return {
          success: true,
          transactions: [],
          message: "WMB benefit does not match configured benefit",
        };
      }

      const ea = await storage.ledger.ea.getOrCreate(
        "employer",
        wmbContext.employerId,
        settings.accountId
      );

      const chargePluginKey = `${config.id}:${ea.id}:${wmbContext.workerId}:${wmbContext.year}:${wmbContext.month}`;

      const expectedEntry = await this.computeExpectedEntry(wmbContext, config, settings);

      const existingEntry = await storage.ledger.entries.getByChargePluginKey(
        this.metadata.id,
        chargePluginKey
      );

      if (!expectedEntry && !existingEntry) {
        logger.debug("No entry expected and none exists, nothing to do", {
          service: "charge-plugin-gbhet-legal-benefit",
          wmbId: wmbContext.wmbId,
        });
        return {
          success: true,
          transactions: [],
          message: "No charge applicable",
        };
      }

      if (!expectedEntry && existingEntry) {
        await storage.ledger.entries.deleteByChargePluginKey(
          this.metadata.id,
          chargePluginKey
        );
        
        logger.info("Deleted ledger entry - benefit no longer applies", {
          service: "charge-plugin-gbhet-legal-benefit",
          wmbId: wmbContext.wmbId,
          deletedEntryId: existingEntry.id,
          previousAmount: existingEntry.amount,
          workerId: wmbContext.workerId,
          year: wmbContext.year,
          month: wmbContext.month,
        });

        const notification: LedgerNotification = {
          type: "deleted",
          amount: existingEntry.amount,
          description: `Ledger entry deleted: -$${existingEntry.amount}`,
        };

        return {
          success: true,
          transactions: [],
          notifications: [notification],
          message: "Deleted ledger entry - benefit no longer applies",
        };
      }

      if (expectedEntry && !existingEntry) {
        const transaction: LedgerTransaction = {
          chargePlugin: this.metadata.id,
          chargePluginKey: expectedEntry.chargePluginKey,
          chargePluginConfigId: config.id,
          accountId: settings.accountId,
          entityType: "employer",
          entityId: wmbContext.employerId,
          amount: expectedEntry.amount,
          description: expectedEntry.description,
          transactionDate: expectedEntry.transactionDate,
          referenceType: expectedEntry.referenceType,
          referenceId: expectedEntry.referenceId,
          metadata: expectedEntry.metadata,
        };

        logger.info("Creating new monthly ledger entry for benefit", {
          service: "charge-plugin-gbhet-legal-benefit",
          wmbId: wmbContext.wmbId,
          amount: expectedEntry.amount,
          workerId: wmbContext.workerId,
          benefitId: wmbContext.benefitId,
          year: wmbContext.year,
          month: wmbContext.month,
        });

        const notification: LedgerNotification = {
          type: "created",
          amount: expectedEntry.amount,
          description: `Ledger entry created: $${expectedEntry.amount}`,
        };

        return {
          success: true,
          transactions: [transaction],
          notifications: [notification],
          message: `Created monthly entry for $${expectedEntry.amount} - ${expectedEntry.description}`,
        };
      }

      if (expectedEntry && existingEntry) {
        const amountChanged = existingEntry.amount !== expectedEntry.amount;
        const memoChanged = existingEntry.memo !== expectedEntry.description;
        const referenceTypeChanged = existingEntry.referenceType !== expectedEntry.referenceType;
        const referenceIdChanged = existingEntry.referenceId !== expectedEntry.referenceId;

        if (!amountChanged && !memoChanged && !referenceTypeChanged && !referenceIdChanged) {
          logger.debug("Ledger entry matches expected state, no update needed", {
            service: "charge-plugin-gbhet-legal-benefit",
            wmbId: wmbContext.wmbId,
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
          referenceType: expectedEntry.referenceType,
          referenceId: expectedEntry.referenceId,
          data: expectedEntry.metadata,
        });

        const changes = [
          amountChanged && 'amount',
          memoChanged && 'memo',
          referenceTypeChanged && 'referenceType',
          referenceIdChanged && 'referenceId',
        ].filter(Boolean).join(', ');

        logger.info("Updated monthly ledger entry for benefit", {
          service: "charge-plugin-gbhet-legal-benefit",
          wmbId: wmbContext.wmbId,
          entryId: existingEntry.id,
          previousAmount: existingEntry.amount,
          newAmount: expectedEntry.amount,
          amountChanged,
          memoChanged,
          referenceTypeChanged,
          referenceIdChanged,
        });

        const notification: LedgerNotification = {
          type: "updated",
          amount: expectedEntry.amount,
          previousAmount: existingEntry.amount,
          description: amountChanged 
            ? `Ledger entry updated: $${existingEntry.amount} → $${expectedEntry.amount}`
            : `Ledger entry updated: $${expectedEntry.amount}`,
        };

        return {
          success: true,
          transactions: [],
          notifications: [notification],
          message: `Updated entry: ${changes} changed`,
        };
      }

      return {
        success: true,
        transactions: [],
        message: "No action taken",
      };

    } catch (error) {
      logger.error("GBHET Legal Benefit plugin execution failed", {
        service: "charge-plugin-gbhet-legal-benefit",
        wmbId: wmbContext.wmbId,
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

      const settings = config.settings as GbhetLegalBenefitSettings;

      if (!entry.referenceId) {
        return {
          ...baseResult,
          isValid: false,
          discrepancies: ["Entry has no referenceId - cannot verify"],
        };
      }

      const data = entry.data as { 
        workerId?: string; 
        employerId?: string; 
        benefitId?: string;
        year?: number; 
        month?: number 
      } | null;
      
      if (!data?.workerId || !data?.employerId || !data?.benefitId || !data?.year || !data?.month) {
        return {
          ...baseResult,
          isValid: false,
          discrepancies: ["Entry missing required metadata (workerId, employerId, benefitId, year, month)"],
        };
      }

      const wmbContext: WmbSavedContext = {
        trigger: TriggerType.WMB_SAVED,
        wmbId: entry.referenceId,
        workerId: data.workerId,
        employerId: data.employerId,
        benefitId: data.benefitId,
        year: data.year,
        month: data.month,
      };

      const expectedEntry = await this.computeExpectedEntry(wmbContext, config, settings);

      if (!expectedEntry) {
        return {
          ...baseResult,
          isValid: false,
          expectedAmount: "0.00",
          expectedDescription: null,
          discrepancies: ["Entry exists but benefit no longer qualifies - entry should be deleted"],
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

registerChargePlugin(new GbhetLegalBenefitPlugin());
