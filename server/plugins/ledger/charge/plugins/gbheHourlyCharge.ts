import { ChargePlugin } from "../base";
import {
  TriggerType,
  PluginContext,
  PluginExecutionResult,
  HoursSavedContext,
  LedgerTransaction,
  LedgerNotification,
  LedgerEntryVerification,
} from "../types";
import { registerChargePlugin } from "../registry";
import { z } from "zod";
import { logger } from "../../../../logger";
import { getCurrentEffectiveRate } from "../../../../utils/rateHistory";
import { storage } from "../../../../storage/database";
import type { Ledger, ChargePluginConfig } from "@shared/schema";

const rateHistoryEntrySchema = z.object({
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format"),
  rate: z.number(),
});

const gbheHourlyChargeSettingsSchema = z.object({
  chargeTo: z.enum(["worker", "employer"]).default("employer"),
  employmentStatusIds: z.array(z.string()).optional(),
  specialDesignationMemberStatusIds: z.array(z.string()).optional(),
  specialDesignationMonthlyHours: z.number().default(135),
  rateHistory: z.array(rateHistoryEntrySchema).min(1, "At least one rate entry is required"),
});

type GbheHourlyChargeSettings = z.infer<typeof gbheHourlyChargeSettingsSchema>;

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

class GbheHourlyChargePlugin extends ChargePlugin {
  readonly metadata = {
    id: "gbhe-hourly-charge",
    name: "GBHE Hourly Charge",
    description: "GBHE hourly charge plugin. Charges based on hours worked with per-hour rates and special designation workers with fixed monthly hours.",
    triggers: [TriggerType.HOURS_SAVED],
    defaultScope: "global" as const,
    settingsSchema: gbheHourlyChargeSettingsSchema,
    requiredComponent: "sitespecific.gbhet",
  };

  private async isSpecialDesignation(
    workerId: string,
    settings: GbheHourlyChargeSettings
  ): Promise<boolean> {
    if (!settings.specialDesignationMemberStatusIds || settings.specialDesignationMemberStatusIds.length === 0) {
      return false;
    }
    const worker = await storage.workers.getWorker(workerId);
    if (!worker || !worker.denormMsIds || worker.denormMsIds.length === 0) {
      return false;
    }
    return worker.denormMsIds.some(msId => settings.specialDesignationMemberStatusIds!.includes(msId));
  }

  private async computeExpectedEntry(
    hoursContext: HoursSavedContext,
    config: any,
    settings: GbheHourlyChargeSettings
  ): Promise<ExpectedEntry | null> {
    if (!config.account) {
      return null;
    }

    if (settings.employmentStatusIds && settings.employmentStatusIds.length > 0) {
      if (!settings.employmentStatusIds.includes(hoursContext.employmentStatusId)) {
        return null;
      }
    }

    const hoursDate = new Date(hoursContext.year, hoursContext.month - 1, hoursContext.day);
    const applicableRate = getCurrentEffectiveRate(settings.rateHistory, hoursDate);

    if (!applicableRate) {
      return null;
    }

    if (applicableRate.rate === 0) {
      return null;
    }

    const isSpecial = await this.isSpecialDesignation(hoursContext.workerId, settings);

    const chargeTo = settings.chargeTo || "employer";
    const entityType = chargeTo === "worker" ? "worker" : "employer";
    const entityId = chargeTo === "worker" ? hoursContext.workerId : hoursContext.employerId;

    const ea = await storage.ledger.ea.getOrCreate(
      entityType,
      entityId,
      config.account
    );

    if (isSpecial) {
      const chargePluginKey = `${config.id}:${ea.id}:${hoursContext.workerId}:${hoursContext.year}:${hoursContext.month}`;
      const monthlyHours = settings.specialDesignationMonthlyHours ?? 135;
      const amount = (monthlyHours * applicableRate.rate).toFixed(2);
      const monthName = hoursDate.toLocaleString('default', { month: 'long' });
      const description = `GBHE Hourly: ${monthName} ${hoursContext.year} (Special Designation: ${monthlyHours} hrs @ $${applicableRate.rate}/hr)`;

      return {
        chargePluginKey,
        amount,
        description,
        transactionDate: new Date(hoursContext.year, hoursContext.month - 1, 1),
        eaId: ea.id,
        referenceType: "hour",
        referenceId: hoursContext.hoursId,
        metadata: {
          pluginId: this.metadata.id,
          pluginConfigId: config.id,
          workerId: hoursContext.workerId,
          employerId: hoursContext.employerId,
          year: hoursContext.year,
          month: hoursContext.month,
          hours: monthlyHours,
          rate: applicableRate.rate,
          effectiveDate: applicableRate.effectiveDate,
          isSpecialDesignation: true,
        },
      };
    }

    const charge = hoursContext.hours * applicableRate.rate;
    if (charge === 0) {
      return null;
    }

    const chargePluginKey = `${config.id}:${ea.id}:${hoursContext.hoursId}`;
    const description = `GBHE Hourly: ${hoursContext.hours} hrs @ $${applicableRate.rate}/hr`;

    return {
      chargePluginKey,
      amount: charge.toFixed(2),
      description,
      transactionDate: hoursDate,
      eaId: ea.id,
      referenceType: "hour",
      referenceId: hoursContext.hoursId,
      metadata: {
        pluginId: this.metadata.id,
        pluginConfigId: config.id,
        workerId: hoursContext.workerId,
        employerId: hoursContext.employerId,
        year: hoursContext.year,
        month: hoursContext.month,
        day: hoursContext.day,
        hours: hoursContext.hours,
        rate: applicableRate.rate,
        effectiveDate: applicableRate.effectiveDate,
        isSpecialDesignation: false,
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
        error: `GBHE Hourly Charge plugin only handles HOURS_SAVED trigger, got ${context.trigger}`,
      };
    }

    const hoursContext = context as HoursSavedContext;

    try {
      const validationResult = this.validateSettings(config.settings);
      if (!validationResult.valid) {
        logger.error("Invalid settings for GBHE Hourly Charge plugin", {
          service: "charge-plugin-gbhe-hourly",
          errors: validationResult.errors,
          configId: config.id,
        });
        return {
          success: false,
          transactions: [],
          error: `Invalid plugin settings: ${validationResult.errors?.join(", ")}`,
        };
      }

      const settings = config.settings as GbheHourlyChargeSettings;

      // No account configured => plugin is inert (produces no new entries).
      if (!config.account) {
        return {
          success: true,
          transactions: [],
          message: "No ledger account configured for this charge plugin",
        };
      }

      const isSpecial = await this.isSpecialDesignation(hoursContext.workerId, settings);

      const chargeTo = settings.chargeTo || "employer";
      const entityType = chargeTo === "worker" ? "worker" : "employer";
      const entityId = chargeTo === "worker" ? hoursContext.workerId : hoursContext.employerId;

      const ea = await storage.ledger.ea.getOrCreate(
        entityType,
        entityId,
        config.account
      );

      if (isSpecial) {
        return this.executeSpecialDesignation(hoursContext, config, settings, ea);
      }

      return this.executeStandard(hoursContext, config, settings, ea);

    } catch (error) {
      logger.error("GBHE Hourly Charge plugin execution failed", {
        service: "charge-plugin-gbhe-hourly",
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

  private async executeSpecialDesignation(
    hoursContext: HoursSavedContext,
    config: any,
    settings: GbheHourlyChargeSettings,
    ea: { id: string }
  ): Promise<PluginExecutionResult> {
    const chargePluginKey = `${config.id}:${ea.id}:${hoursContext.workerId}:${hoursContext.year}:${hoursContext.month}`;

    const expectedEntry = await this.computeExpectedEntry(hoursContext, config, settings);

    const existingEntriesForHours = await storage.ledger.entries.getByReferenceAndConfig(
      hoursContext.hoursId,
      config.id
    );

    for (const staleEntry of existingEntriesForHours) {
      const entryData = staleEntry.data as { year?: number; month?: number } | null;
      if (entryData?.year !== hoursContext.year || entryData?.month !== hoursContext.month) {
        await storage.ledger.entries.delete(staleEntry.id);
        logger.info("Deleted stale GBHE Hourly entry - hours moved to different month", {
          service: "charge-plugin-gbhe-hourly",
          hoursId: hoursContext.hoursId,
          deletedEntryId: staleEntry.id,
        });
      }
    }

    const existingEntry = await storage.ledger.entries.getByChargePluginKey(
      this.metadata.id,
      chargePluginKey
    );

    if (!expectedEntry && !existingEntry) {
      return {
        success: true,
        transactions: [],
        message: "No charge applicable (special designation)",
      };
    }

    if (!expectedEntry && existingEntry) {
      await storage.ledger.entries.deleteByChargePluginKey(
        this.metadata.id,
        chargePluginKey
      );
      return {
        success: true,
        transactions: [],
        notifications: [{
          type: "deleted" as const,
          amount: existingEntry.amount,
          description: `GBHE Hourly entry deleted: -$${existingEntry.amount}`,
        }],
        message: "Deleted GBHE Hourly entry - no longer qualifying",
      };
    }

    if (expectedEntry && !existingEntry) {
      const transaction: LedgerTransaction = {
        chargePlugin: this.metadata.id,
        chargePluginKey: expectedEntry.chargePluginKey,
        chargePluginConfigId: config.id,
        accountId: config.account,
        entityType: settings.chargeTo === "worker" ? "worker" : "employer",
        entityId: settings.chargeTo === "worker" ? hoursContext.workerId : hoursContext.employerId,
        amount: expectedEntry.amount,
        description: expectedEntry.description,
        transactionDate: expectedEntry.transactionDate,
        referenceType: expectedEntry.referenceType,
        referenceId: expectedEntry.referenceId,
        metadata: expectedEntry.metadata,
      };

      logger.info("Creating GBHE Hourly entry (special designation)", {
        service: "charge-plugin-gbhe-hourly",
        amount: expectedEntry.amount,
        workerId: hoursContext.workerId,
        year: hoursContext.year,
        month: hoursContext.month,
      });

      return {
        success: true,
        transactions: [transaction],
        notifications: [{
          type: "created" as const,
          amount: expectedEntry.amount,
          description: `GBHE Hourly entry created: $${expectedEntry.amount}`,
        }],
        message: `Created special designation monthly entry for $${expectedEntry.amount}`,
      };
    }

    if (expectedEntry && existingEntry) {
      const amountChanged = existingEntry.amount !== expectedEntry.amount;

      if (!amountChanged) {
        return {
          success: true,
          transactions: [],
          message: "GBHE Hourly entry already matches expected state (special designation)",
        };
      }

      const existingAmount = parseFloat(existingEntry.amount);
      const newAmount = parseFloat(expectedEntry.amount);
      const adjustmentAmount = (newAmount - existingAmount).toFixed(2);
      const adjustmentKey = `${expectedEntry.chargePluginKey}:adj:${Date.now()}`;
      const prevHours = (existingEntry.data as any)?.hours ?? "?";
      const newHours = (expectedEntry.metadata as any)?.hours ?? "?";
      const description = `GBHE Hourly Adjustment (Special): ${prevHours} → ${newHours} hrs @ $${(expectedEntry.metadata as any).rate}/hr (${adjustmentAmount.startsWith("-") ? adjustmentAmount : "+" + adjustmentAmount})`;

      const transaction: LedgerTransaction = {
        chargePlugin: this.metadata.id,
        chargePluginKey: adjustmentKey,
        chargePluginConfigId: config.id,
        accountId: config.account,
        entityType: settings.chargeTo === "worker" ? "worker" : "employer",
        entityId: settings.chargeTo === "worker" ? hoursContext.workerId : hoursContext.employerId,
        amount: adjustmentAmount,
        description,
        transactionDate: expectedEntry.transactionDate,
        referenceType: "hour_adjustment",
        referenceId: hoursContext.hoursId,
        metadata: {
          ...expectedEntry.metadata,
          adjustmentType: "hours_change",
          originalEntryId: existingEntry.id,
          originalAmount: existingEntry.amount,
          newAmount: expectedEntry.amount,
          originalHours: prevHours,
          newHours,
        },
      };

      logger.info("Creating GBHE Hourly adjustment entry (special designation)", {
        service: "charge-plugin-gbhe-hourly",
        hoursId: hoursContext.hoursId,
        originalAmount: existingEntry.amount,
        newAmount: expectedEntry.amount,
        adjustmentAmount,
        workerId: hoursContext.workerId,
        year: hoursContext.year,
        month: hoursContext.month,
      });

      return {
        success: true,
        transactions: [transaction],
        notifications: [{
          type: "created" as const,
          amount: adjustmentAmount,
          description: `GBHE Hourly adjustment (special): $${existingEntry.amount} → $${expectedEntry.amount} (adjustment: $${adjustmentAmount})`,
        }],
        message: `Created special designation adjustment entry for $${adjustmentAmount}`,
      };
    }

    return { success: true, transactions: [], message: "No action taken" };
  }

  private async executeStandard(
    hoursContext: HoursSavedContext,
    config: any,
    settings: GbheHourlyChargeSettings,
    ea: { id: string }
  ): Promise<PluginExecutionResult> {
    const expectedEntry = await this.computeExpectedEntry(hoursContext, config, settings);
    const chargePluginKey = `${config.id}:${ea.id}:${hoursContext.hoursId}`;

    const existingEntry = await storage.ledger.entries.getByChargePluginKey(
      this.metadata.id,
      chargePluginKey
    );

    if (!expectedEntry && !existingEntry) {
      return {
        success: true,
        transactions: [],
        message: "No charge applicable (employment status filtered or zero rate)",
      };
    }

    if (!expectedEntry && existingEntry) {
      await storage.ledger.entries.deleteByChargePluginKey(
        this.metadata.id,
        chargePluginKey
      );
      return {
        success: true,
        transactions: [],
        notifications: [{
          type: "deleted" as const,
          amount: existingEntry.amount,
          description: `GBHE Hourly entry deleted: -$${existingEntry.amount}`,
        }],
        message: "Deleted GBHE Hourly entry - no longer qualifying",
      };
    }

    if (expectedEntry && !existingEntry) {
      const transaction: LedgerTransaction = {
        chargePlugin: this.metadata.id,
        chargePluginKey: expectedEntry.chargePluginKey,
        chargePluginConfigId: config.id,
        accountId: config.account,
        entityType: settings.chargeTo === "worker" ? "worker" : "employer",
        entityId: settings.chargeTo === "worker" ? hoursContext.workerId : hoursContext.employerId,
        amount: expectedEntry.amount,
        description: expectedEntry.description,
        transactionDate: expectedEntry.transactionDate,
        referenceType: expectedEntry.referenceType,
        referenceId: expectedEntry.referenceId,
        metadata: expectedEntry.metadata,
      };

      logger.info("Creating GBHE Hourly hourly entry", {
        service: "charge-plugin-gbhe-hourly",
        hoursId: hoursContext.hoursId,
        amount: expectedEntry.amount,
        hours: hoursContext.hours,
        rate: (expectedEntry.metadata as any).rate,
      });

      return {
        success: true,
        transactions: [transaction],
        notifications: [{
          type: "created" as const,
          amount: expectedEntry.amount,
          description: `GBHE Hourly entry created: $${expectedEntry.amount}`,
        }],
        message: `Created hourly entry for $${expectedEntry.amount}`,
      };
    }

    if (expectedEntry && existingEntry) {
      const amountChanged = existingEntry.amount !== expectedEntry.amount;

      if (!amountChanged) {
        return {
          success: true,
          transactions: [],
          message: "GBHE Hourly entry already matches expected state",
        };
      }

      const existingAmount = parseFloat(existingEntry.amount);
      const newAmount = parseFloat(expectedEntry.amount);
      const adjustmentAmount = (newAmount - existingAmount).toFixed(2);
      const adjustmentKey = `${expectedEntry.chargePluginKey}:adj:${Date.now()}`;
      const prevHours = (existingEntry.data as any)?.hours ?? "?";
      const description = `GBHE Hourly Adjustment: ${prevHours} → ${hoursContext.hours} hrs @ $${(expectedEntry.metadata as any).rate}/hr (${adjustmentAmount.startsWith("-") ? adjustmentAmount : "+" + adjustmentAmount})`;

      const transaction: LedgerTransaction = {
        chargePlugin: this.metadata.id,
        chargePluginKey: adjustmentKey,
        chargePluginConfigId: config.id,
        accountId: config.account,
        entityType: settings.chargeTo === "worker" ? "worker" : "employer",
        entityId: settings.chargeTo === "worker" ? hoursContext.workerId : hoursContext.employerId,
        amount: adjustmentAmount,
        description,
        transactionDate: expectedEntry.transactionDate,
        referenceType: "hour_adjustment",
        referenceId: hoursContext.hoursId,
        metadata: {
          ...expectedEntry.metadata,
          adjustmentType: "hours_change",
          originalEntryId: existingEntry.id,
          originalAmount: existingEntry.amount,
          newAmount: expectedEntry.amount,
          originalHours: prevHours,
          newHours: hoursContext.hours,
        },
      };

      logger.info("Creating GBHE Hourly adjustment entry", {
        service: "charge-plugin-gbhe-hourly",
        hoursId: hoursContext.hoursId,
        originalAmount: existingEntry.amount,
        newAmount: expectedEntry.amount,
        adjustmentAmount,
        originalHours: prevHours,
        newHours: hoursContext.hours,
      });

      return {
        success: true,
        transactions: [transaction],
        notifications: [{
          type: "created" as const,
          amount: adjustmentAmount,
          description: `GBHE Hourly adjustment: $${existingEntry.amount} → $${expectedEntry.amount} (adjustment: $${adjustmentAmount})`,
        }],
        message: `Created adjustment entry for $${adjustmentAmount}`,
      };
    }

    return { success: true, transactions: [], message: "No action taken" };
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
      if (entry.referenceType === "hour_adjustment") {
        const data = entry.data as {
          adjustmentType?: string;
          originalAmount?: string;
          newAmount?: string;
          originalEntryId?: string;
        } | null;

        if (!data?.originalAmount || !data?.newAmount) {
          return {
            ...baseResult,
            isValid: false,
            discrepancies: ["Adjustment entry missing required metadata (originalAmount, newAmount)"],
          };
        }

        const expectedAdjustment = (parseFloat(data.newAmount) - parseFloat(data.originalAmount)).toFixed(2);
        const discrepancies: string[] = [];
        if (entry.amount !== expectedAdjustment) {
          discrepancies.push(`Adjustment amount mismatch: expected ${expectedAdjustment}, found ${entry.amount}`);
        }

        return {
          ...baseResult,
          isValid: discrepancies.length === 0,
          expectedAmount: expectedAdjustment,
          discrepancies,
        };
      }

      const validationResult = this.validateSettings(config.settings);
      if (!validationResult.valid) {
        return {
          ...baseResult,
          isValid: false,
          discrepancies: [`Invalid plugin configuration: ${validationResult.errors?.join(", ")}`],
        };
      }

      const settings = config.settings as GbheHourlyChargeSettings;

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
        year?: number;
        month?: number;
        day?: number;
        hours?: number;
        isSpecialDesignation?: boolean;
      } | null;

      if (!data?.workerId || !data?.employerId || !data?.year || !data?.month) {
        return {
          ...baseResult,
          isValid: false,
          discrepancies: ["Entry missing required metadata (workerId, employerId, year, month)"],
        };
      }

      const hoursContext: HoursSavedContext = {
        trigger: TriggerType.HOURS_SAVED,
        hoursId: entry.referenceId,
        workerId: data.workerId,
        employerId: data.employerId,
        year: data.year,
        month: data.month,
        day: data.day ?? 1,
        hours: data.hours ?? 0,
        employmentStatusId: "",
        home: false,
      };

      const expectedEntry = await this.computeExpectedEntry(hoursContext, config, settings);

      if (!expectedEntry) {
        return {
          ...baseResult,
          isValid: false,
          expectedAmount: "0.00",
          expectedDescription: null,
          discrepancies: ["Entry exists but no charge expected - entry should be deleted"],
        };
      }

      const discrepancies: string[] = [];

      const allEntriesForHours = await storage.ledger.entries.getByReferenceAndConfig(
        entry.referenceId,
        config.id
      );
      const adjustmentEntries = allEntriesForHours.filter(e => e.referenceType === "hour_adjustment");
      const hasAdjustments = adjustmentEntries.length > 0;

      if (hasAdjustments) {
        const totalAmount = allEntriesForHours.reduce((sum, e) => sum + parseFloat(e.amount), 0);
        const expectedAmount = parseFloat(expectedEntry.amount);
        if (Math.abs(totalAmount - expectedAmount) > 0.01) {
          discrepancies.push(`Total amount mismatch (base + ${adjustmentEntries.length} adjustment(s)): expected ${expectedEntry.amount}, total is ${totalAmount.toFixed(2)}`);
        }
      } else {
        if (entry.amount !== expectedEntry.amount) {
          discrepancies.push(`Amount mismatch: expected ${expectedEntry.amount}, found ${entry.amount}`);
        }
      }

      return {
        ...baseResult,
        isValid: discrepancies.length === 0,
        expectedAmount: expectedEntry.amount,
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

registerChargePlugin(new GbheHourlyChargePlugin());
