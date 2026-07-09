import { ChargePlugin } from "../base";
import {
  TriggerType,
  PluginContext,
  PluginExecutionResult,
  HoursSavedContext,
  LedgerTransaction,
  LedgerEntryVerification,
} from "../types";
import { registerChargePlugin } from "../registry";
import type { ChargePluginMetadata } from "../types";
import { z } from "zod";
import { logger } from "../../../../logger";
import { storage } from "../../../../storage/database";
import type { Ledger, ChargePluginConfig } from "@shared/schema";

/**
 * BAO Hourly charge plugin.
 *
 * Bills the EMPLOYER per reported hour. Unlike the GBHE hourly plugin, the
 * per-hour rate is NOT stored in plugin settings: it is looked up from the
 * `sitespecific_bao_employer_rates` table (per employer, per fund account,
 * effective-dated) via `storage.baoEmployerRates.getEffectiveRate`, using the
 * hours entry's work date. This means one enabled config per fund account can
 * bill every employer at that employer's own negotiated rate.
 *
 * Employment-status gating: settings expose a billed list and a non-billed
 * (exclusion) list. The exclusion list always wins (e.g. "No Charge" hours);
 * when the billed list is non-empty, only those statuses are billed; when it
 * is empty, all statuses not excluded are billed.
 *
 * The charge's statement date is anchored to the work month (first of the
 * month), so re-uploading a month reconciles against the same statement.
 * Idempotency follows the existing hourly-charge pattern: one base entry per
 * hours row keyed by `${configId}:${eaId}:${hoursId}`, with adjustment entries
 * when the amount changes and deletion when the row no longer qualifies.
 */

const baoHourlySettingsSchema = z.object({
  billedEmploymentStatusIds: z.array(z.string()).optional(),
  nonBilledEmploymentStatusIds: z.array(z.string()).optional(),
});

type BaoHourlySettings = z.infer<typeof baoHourlySettingsSchema>;

interface ExpectedEntry {
  chargePluginKey: string;
  amount: string;
  description: string;
  transactionDate: Date;
  statementYmd: string;
  eaId: string;
  referenceType: string;
  referenceId: string;
  metadata: Record<string, any>;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** First day of the work month, as a YYYY-MM-DD string. */
function workMonthStatementYmd(year: number, month: number): string {
  return `${year}-${pad2(month)}-01`;
}

function workDateYmd(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function monthName(year: number, month: number): string {
  return new Date(year, month - 1, 1).toLocaleString("default", {
    month: "long",
  });
}

/** True when this hours row's employment status should be billed. */
export function isStatusBilled(
  settings: BaoHourlySettings,
  employmentStatusId: string,
): boolean {
  if (settings.nonBilledEmploymentStatusIds?.includes(employmentStatusId)) {
    return false;
  }
  if (
    settings.billedEmploymentStatusIds &&
    settings.billedEmploymentStatusIds.length > 0
  ) {
    return settings.billedEmploymentStatusIds.includes(employmentStatusId);
  }
  return true;
}

class BaoHourlyChargePlugin extends ChargePlugin {
  readonly metadata: ChargePluginMetadata = {
    id: "bao-hourly",
    name: "BAO - Hourly Charge",
    description:
      "Bills employers per reported hour. The per-hour rate comes from the BAO Employer Rates table (per employer, per fund account, effective-dated) as of the work date. Settings control which employment statuses are billed; excluded statuses (e.g. No Charge) create no charge. Statement date is anchored to the work month.",
    triggers: [TriggerType.HOURS_SAVED],
    defaultScope: "global" as const,
    supportedScopes: ["global", "employer"] as const,
    configSchema: {
      type: "object",
      properties: {
        billedEmploymentStatusIds: {
          type: "array",
          title: "Billed Employment Statuses",
          description:
            "Optional. When set, ONLY hours with these employment statuses are billed. Leave empty to bill all statuses except the non-billed list below.",
          items: { type: "string" },
          uniqueItems: true,
          "x-options-resource": "employment-status",
        },
        nonBilledEmploymentStatusIds: {
          type: "array",
          title: "Non-Billed Employment Statuses",
          description:
            "Hours with these employment statuses are never billed (e.g. No Charge). This list wins over the billed list.",
          items: { type: "string" },
          uniqueItems: true,
          "x-options-resource": "employment-status",
        },
      },
    },
    requiredComponent: "sitespecific.bao",
  };

  /**
   * Compute the ledger entry that SHOULD exist for this hours row, or null
   * when no charge applies (non-billed status, no effective rate, zero rate,
   * or zero hours).
   */
  private async computeExpectedEntry(
    hoursContext: HoursSavedContext,
    config: ChargePluginConfig,
    settings: BaoHourlySettings,
    ea: { id: string },
  ): Promise<ExpectedEntry | null> {
    if (!config.account) {
      return null;
    }

    if (!isStatusBilled(settings, hoursContext.employmentStatusId)) {
      return null;
    }

    const asOfYmd = workDateYmd(
      hoursContext.year,
      hoursContext.month,
      hoursContext.day,
    );
    const rateRow = await storage.baoEmployerRates.getEffectiveRate(
      hoursContext.employerId,
      config.account,
      asOfYmd,
    );
    if (!rateRow) {
      logger.info("BAO Hourly: no effective rate for employer/account - skipping", {
        service: "charge-plugin-bao-hourly",
        employerId: hoursContext.employerId,
        accountId: config.account,
        asOfYmd,
        hoursId: hoursContext.hoursId,
      });
      return null;
    }

    const rate = parseFloat(rateRow.rate);
    if (!Number.isFinite(rate) || rate === 0) {
      logger.info("BAO Hourly: effective rate is zero or invalid - skipping", {
        service: "charge-plugin-bao-hourly",
        employerId: hoursContext.employerId,
        accountId: config.account,
        rateId: rateRow.id,
        rate: rateRow.rate,
        hoursId: hoursContext.hoursId,
      });
      return null;
    }

    const charge = hoursContext.hours * rate;
    if (charge === 0) {
      logger.info("BAO Hourly: zero hours - skipping", {
        service: "charge-plugin-bao-hourly",
        employerId: hoursContext.employerId,
        accountId: config.account,
        hours: hoursContext.hours,
        hoursId: hoursContext.hoursId,
      });
      return null;
    }

    const chargePluginKey = `${config.id}:${ea.id}:${hoursContext.hoursId}`;
    const label = `${monthName(hoursContext.year, hoursContext.month)} ${hoursContext.year}`;

    // Worker identification for the memo (display-only; never part of the
    // idempotency key). Soft-fail: a missing worker/contact never blocks the
    // charge.
    let workerName = "";
    let ssnLast4 = "";
    try {
      const worker = await storage.workers.getWorker(hoursContext.workerId);
      if (worker) {
        if (worker.ssn && worker.ssn.length >= 4) {
          ssnLast4 = worker.ssn.slice(-4);
        }
        const contact = await storage.contacts.getContact(worker.contactId);
        if (contact?.displayName) {
          workerName = contact.displayName;
        }
      }
    } catch (error) {
      logger.warn("BAO Hourly: failed to resolve worker name for memo", {
        service: "charge-plugin-bao-hourly",
        workerId: hoursContext.workerId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    const workerLabel = workerName
      ? ssnLast4
        ? `${workerName} (***${ssnLast4})`
        : workerName
      : "";

    const description = workerLabel
      ? `BAO Hourly: ${workerLabel} — ${hoursContext.hours} hrs @ $${rate}/hr (${label})`
      : `BAO Hourly: ${hoursContext.hours} hrs @ $${rate}/hr (${label})`;

    return {
      chargePluginKey,
      amount: charge.toFixed(2),
      description,
      transactionDate: new Date(
        hoursContext.year,
        hoursContext.month - 1,
        1,
      ),
      statementYmd: workMonthStatementYmd(hoursContext.year, hoursContext.month),
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
        rate,
        rateId: rateRow.id,
        rateEffectiveYmd: rateRow.effectiveYmd,
        ...(workerName ? { workerName } : {}),
        ...(ssnLast4 ? { ssnLast4 } : {}),
      },
    };
  }

  async execute(
    context: PluginContext,
    config: ChargePluginConfig,
  ): Promise<PluginExecutionResult> {
    if (context.trigger !== TriggerType.HOURS_SAVED) {
      return {
        success: false,
        transactions: [],
        error: `BAO Hourly Charge plugin only handles HOURS_SAVED trigger, got ${context.trigger}`,
      };
    }

    const hoursContext = context as HoursSavedContext;

    try {
      const validationResult = this.validateSettings(config.settings);
      if (!validationResult.valid) {
        logger.error("Invalid settings for BAO Hourly Charge plugin", {
          service: "charge-plugin-bao-hourly",
          errors: validationResult.errors,
          configId: config.id,
        });
        return {
          success: false,
          transactions: [],
          error: `Invalid plugin settings: ${validationResult.errors?.join(", ")}`,
        };
      }

      const settings = (config.settings ?? {}) as BaoHourlySettings;

      // No account configured => plugin is inert (produces no new entries).
      if (!config.account) {
        return {
          success: true,
          transactions: [],
          message: "No ledger account configured for this charge plugin",
        };
      }

      // The employer is always the billed entity.
      const ea = await storage.ledger.ea.getOrCreate(
        "employer",
        hoursContext.employerId,
        config.account,
      );
      const chargePluginKey = `${config.id}:${ea.id}:${hoursContext.hoursId}`;

      const expectedEntry = await this.computeExpectedEntry(
        hoursContext,
        config,
        settings,
        ea,
      );

      const existingEntry = await storage.ledger.entries.getByChargePluginKey(
        this.metadata.id,
        chargePluginKey,
      );

      if (!expectedEntry && !existingEntry) {
        return {
          success: true,
          transactions: [],
          message:
            "No charge applicable (non-billed status, no effective rate, or zero amount)",
        };
      }

      if (!expectedEntry && existingEntry) {
        // The hours row no longer qualifies: remove the base entry and any
        // adjustment entries posted against the same hours row.
        const allEntries = await storage.ledger.entries.getByReferenceAndConfig(
          hoursContext.hoursId,
          config.id,
        );
        let removedTotal = 0;
        for (const entry of allEntries) {
          removedTotal += parseFloat(entry.amount);
          await storage.ledger.entries.delete(entry.id);
        }
        const removed = removedTotal.toFixed(2);

        logger.info("Deleted BAO Hourly entries - no longer qualifying", {
          service: "charge-plugin-bao-hourly",
          hoursId: hoursContext.hoursId,
          removedEntries: allEntries.length,
          removedTotal: removed,
        });

        return {
          success: true,
          transactions: [],
          notifications: [
            {
              type: "deleted" as const,
              amount: removed,
              description: `BAO Hourly entry deleted: -$${removed}`,
            },
          ],
          message: "Deleted BAO Hourly entry - no longer qualifying",
        };
      }

      // From here a charge applies (expectedEntry is non-null).
      if (expectedEntry && !existingEntry) {
        const transaction: LedgerTransaction = {
          chargePlugin: this.metadata.id,
          chargePluginKey: expectedEntry.chargePluginKey,
          chargePluginConfigId: config.id,
          accountId: config.account,
          entityType: "employer",
          entityId: hoursContext.employerId,
          amount: expectedEntry.amount,
          description: expectedEntry.description,
          transactionDate: expectedEntry.transactionDate,
          statementYmd: expectedEntry.statementYmd,
          referenceType: expectedEntry.referenceType,
          referenceId: expectedEntry.referenceId,
          metadata: expectedEntry.metadata,
        };

        logger.info("Creating BAO Hourly entry", {
          service: "charge-plugin-bao-hourly",
          hoursId: hoursContext.hoursId,
          employerId: hoursContext.employerId,
          amount: expectedEntry.amount,
          hours: hoursContext.hours,
          rate: (expectedEntry.metadata as any).rate,
        });

        return {
          success: true,
          transactions: [transaction],
          notifications: [
            {
              type: "created" as const,
              amount: expectedEntry.amount,
              description: `BAO Hourly entry created: $${expectedEntry.amount}`,
            },
          ],
          message: `Created hourly entry for $${expectedEntry.amount}`,
        };
      }

      // Both exist: reconcile the net posted total (base + adjustments) to
      // the expected amount with a single correcting delta. Idempotent: when
      // the totals already match, do nothing.
      const allEntries = await storage.ledger.entries.getByReferenceAndConfig(
        hoursContext.hoursId,
        config.id,
      );
      const netTotal = allEntries.reduce(
        (sum, e) => sum + parseFloat(e.amount),
        0,
      );
      const expectedAmount = parseFloat(expectedEntry!.amount);
      const delta = Number((expectedAmount - netTotal).toFixed(2));
      if (Math.abs(delta) < 0.005) {
        return {
          success: true,
          transactions: [],
          message: "BAO Hourly entry already matches expected state",
        };
      }

      const netTotalStr = netTotal.toFixed(2);
      const adjustmentAmount = delta.toFixed(2);
      const adjustmentKey = `${expectedEntry!.chargePluginKey}:adj:${Date.now()}`;
      const signed = adjustmentAmount.startsWith("-")
        ? adjustmentAmount
        : `+${adjustmentAmount}`;
      const adjMeta = expectedEntry!.metadata as any;
      const adjWorkerLabel = adjMeta.workerName
        ? adjMeta.ssnLast4
          ? `${adjMeta.workerName} (***${adjMeta.ssnLast4}) — `
          : `${adjMeta.workerName} — `
        : "";
      const description = `BAO Hourly Adjustment: ${adjWorkerLabel}$${netTotalStr} → $${expectedEntry!.amount} @ $${adjMeta.rate}/hr (${signed})`;

      const transaction: LedgerTransaction = {
        chargePlugin: this.metadata.id,
        chargePluginKey: adjustmentKey,
        chargePluginConfigId: config.id,
        accountId: config.account,
        entityType: "employer",
        entityId: hoursContext.employerId,
        amount: adjustmentAmount,
        description,
        transactionDate: expectedEntry!.transactionDate,
        statementYmd: expectedEntry!.statementYmd,
        referenceType: "hour_adjustment",
        referenceId: hoursContext.hoursId,
        metadata: {
          ...expectedEntry!.metadata,
          adjustmentType: "amount_change",
          originalEntryId: existingEntry!.id,
          previousTotal: netTotalStr,
          newAmount: expectedEntry!.amount,
        },
      };

      logger.info("Creating BAO Hourly adjustment entry", {
        service: "charge-plugin-bao-hourly",
        hoursId: hoursContext.hoursId,
        previousTotal: netTotalStr,
        newAmount: expectedEntry!.amount,
        adjustmentAmount,
      });

      return {
        success: true,
        transactions: [transaction],
        notifications: [
          {
            type: "created" as const,
            amount: adjustmentAmount,
            description: `BAO Hourly adjustment: $${netTotalStr} → $${expectedEntry!.amount} (adjustment: $${adjustmentAmount})`,
          },
        ],
        message: `Created adjustment entry for $${adjustmentAmount}`,
      };
    } catch (error) {
      logger.error("BAO Hourly Charge plugin execution failed", {
        service: "charge-plugin-bao-hourly",
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

  async verifyEntry(
    entry: Ledger,
    config: ChargePluginConfig,
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
        // Adjustments are verified through the base entry's net-total check.
        return baseResult;
      }

      const validationResult = this.validateSettings(config.settings);
      if (!validationResult.valid) {
        return {
          ...baseResult,
          isValid: false,
          discrepancies: [
            `Invalid plugin configuration: ${validationResult.errors?.join(", ")}`,
          ],
        };
      }

      const settings = (config.settings ?? {}) as BaoHourlySettings;

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
      } | null;

      if (!data?.workerId || !data?.employerId || !data?.year || !data?.month) {
        return {
          ...baseResult,
          isValid: false,
          discrepancies: [
            "Entry missing required metadata (workerId, employerId, year, month)",
          ],
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

      const ea = await storage.ledger.ea.getOrCreate(
        "employer",
        data.employerId,
        config.account!,
      );

      // Verification cannot re-check status gating (the entry stores no
      // status), so it re-computes with gating bypassed via the stored data.
      const expectedEntry = await this.computeExpectedEntry(
        { ...hoursContext, employmentStatusId: "__verify__" },
        config,
        { ...settings, billedEmploymentStatusIds: [], nonBilledEmploymentStatusIds: [] },
        ea,
      );

      if (!expectedEntry) {
        return {
          ...baseResult,
          isValid: false,
          expectedAmount: "0.00",
          discrepancies: [
            "Entry exists but no charge expected - entry should be deleted",
          ],
        };
      }

      const discrepancies: string[] = [];
      const allEntriesForHours =
        await storage.ledger.entries.getByReferenceAndConfig(
          entry.referenceId,
          config.id,
        );
      const totalAmount = allEntriesForHours.reduce(
        (sum, e) => sum + parseFloat(e.amount),
        0,
      );
      const expectedAmount = parseFloat(expectedEntry.amount);
      if (Math.abs(totalAmount - expectedAmount) > 0.01) {
        discrepancies.push(
          `Total amount mismatch (base + adjustments): expected ${expectedEntry.amount}, total is ${totalAmount.toFixed(2)}`,
        );
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
        discrepancies: [
          `Verification error: ${error instanceof Error ? error.message : String(error)}`,
        ],
      };
    }
  }
}

export const baoHourlyChargePlugin = new BaoHourlyChargePlugin();
registerChargePlugin(baoHourlyChargePlugin);
