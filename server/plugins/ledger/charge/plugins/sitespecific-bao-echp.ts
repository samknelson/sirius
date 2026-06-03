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
import { z } from "zod";
import { logger } from "../../../../logger";
import { storage } from "../../../../storage/database";
import { createUnifiedOptionsStorage } from "../../../../storage/unified-options";
import { fetchBuildupStatus } from "../../../trust/eligibility/plugins/sitespecific-bao-buildup";
import { computeEchpHoursPrice } from "../../../../modules/sitespecific/bao/echp-pricing";
import type { Ledger, ChargePluginConfig } from "@shared/schema";

/**
 * Event Center Hours Purchase (ECHP) charge plugin.
 *
 * When a worker buys "event center" hours, the purchase is recorded as a single
 * ECHP-type hours entry for the targeted month (see
 * `server/modules/sitespecific/bao/echp.ts`). Saving that hours row fires the
 * HOURS_SAVED trigger, which runs this plugin to bill the worker the price they
 * were quoted at purchase time.
 *
 * It only acts when ALL of the following hold:
 *   - the hours entry's employment status is the `ECHP` option, and
 *   - the saved hours are positive, and
 *   - the worker has an active election (policy + employer) as of the targeted
 *     month, and
 *   - ECHP is enabled and priced on that policy, and
 *   - the reproduced price is greater than zero.
 *
 * Pricing reproduces the purchase-time quote without re-summing the month's
 * hours (which would double-count the now-saved ECHP row): the price ladder is
 * keyed off hours WORKED, and
 *     hoursWorked = threshold - purchasedHours
 * where `threshold` is the worker's member-status buildup threshold (stable,
 * independent of hours) and `purchasedHours` is the saved ECHP entry's hours.
 *
 * The charge is always billed to the worker (participant). All DB access goes
 * through the storage layer; this file builds no queries.
 */

const ECHP_CODE = "ECHP";

const optionsStorage = createUnifiedOptionsStorage();

const baoEchpChargeSettingsSchema = z.object({
  accountId: z.string().uuid("Account ID must be a valid UUID"),
});

type BaoEchpChargeSettings = z.infer<typeof baoEchpChargeSettingsSchema>;

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

/** Last day of the given month, as a YYYY-MM-DD string. */
function lastDayOfMonthYmd(year: number, month: number): string {
  const d = new Date(year, month, 0);
  const yr = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const dy = String(d.getDate()).padStart(2, "0");
  return `${yr}-${mo}-${dy}`;
}

function monthName(year: number, month: number): string {
  return new Date(year, month - 1, 1).toLocaleString("default", { month: "long" });
}

class BaoEchpChargePlugin extends ChargePlugin {
  readonly metadata = {
    id: "sitespecific-bao-echp",
    name: "BAO - Event Center Hours Purchase Charge",
    description:
      "Bills a worker for an Event Center Hours Purchase (ECHP). When an ECHP-type hours entry is saved, charges the worker the price they were quoted, derived from their member-status buildup threshold and the hours purchased, using the per-policy ECHP pricing ladder. Charges the worker (participant) to the configured account.",
    triggers: [TriggerType.HOURS_SAVED],
    defaultScope: "global" as const,
    settingsSchema: baoEchpChargeSettingsSchema,
    requiredComponent: "sitespecific.bao",
  };

  /** Resolve the id of the ECHP employment-status option, if it exists. */
  private async resolveEchpStatusId(): Promise<string | null> {
    const statuses = await optionsStorage.list("employment-status");
    const echp = statuses.find((s: any) => s.code === ECHP_CODE);
    return echp?.id ?? null;
  }

  /**
   * Compute the ledger entry that SHOULD exist for this hours row, or null when
   * no charge applies. Mirrors the eligibility/pricing logic in
   * `evaluateEchpEligibility` so the worker is billed exactly what they were
   * quoted.
   */
  private async computeExpectedEntry(
    hoursContext: HoursSavedContext,
    config: ChargePluginConfig,
    settings: BaoEchpChargeSettings,
    ea: { id: string },
  ): Promise<ExpectedEntry | null> {
    // Only ECHP-type hours entries are billable.
    const echpStatusId = await this.resolveEchpStatusId();
    if (!echpStatusId || hoursContext.employmentStatusId !== echpStatusId) {
      return null;
    }

    // A deletion / cleared entry arrives with hours = 0 and must not be billed.
    if (!(hoursContext.hours > 0)) {
      return null;
    }

    // The worker must have an active election (policy + employer) as of the
    // targeted month.
    const asOfYmd = lastDayOfMonthYmd(hoursContext.year, hoursContext.month);
    const election = await storage.workerTrustElections.getActiveByWorkerAsOf(
      hoursContext.workerId,
      asOfYmd,
    );
    if (!election || !election.policyId || !election.employerId) {
      return null;
    }

    // ECHP must be enabled and priced on the worker's policy.
    let echpConfig;
    try {
      echpConfig = await storage.baoEchpConfig.get(election.policyId);
    } catch {
      return null;
    }
    if (!echpConfig.enabled || echpConfig.breakpoints.length === 0) {
      return null;
    }

    // Reproduce the purchase-time price. The threshold is resolved from the
    // worker's member status (stable, independent of hours), so re-deriving
    // hoursWorked from it avoids double-counting the now-saved ECHP row.
    const buildup = await fetchBuildupStatus(
      hoursContext.workerId,
      { year: hoursContext.year, month: hoursContext.month },
      { employerId: election.employerId },
    );
    const threshold = buildup.threshold;
    const hoursWorked = Math.max(0, threshold - hoursContext.hours);
    const price = computeEchpHoursPrice(hoursWorked, echpConfig.breakpoints);
    if (price <= 0) {
      return null;
    }

    const amount = price.toFixed(2);
    const chargePluginKey = `${config.id}:${ea.id}:${hoursContext.hoursId}`;
    const label = `${monthName(hoursContext.year, hoursContext.month)} ${hoursContext.year}`;
    const description = `ECHP Hours Purchase: ${hoursContext.hours} hrs for ${label} ($${amount})`;

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
        employerId: election.employerId,
        policyId: election.policyId,
        year: hoursContext.year,
        month: hoursContext.month,
        hoursPurchased: hoursContext.hours,
        hoursWorked,
        threshold,
        price,
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
        error: `BAO ECHP Charge plugin only handles HOURS_SAVED trigger, got ${context.trigger}`,
      };
    }

    const hoursContext = context as HoursSavedContext;

    try {
      const validationResult = this.validateSettings(config.settings);
      if (!validationResult.valid) {
        logger.error("Invalid settings for BAO ECHP Charge plugin", {
          service: "charge-plugin-bao-echp",
          errors: validationResult.errors,
          configId: config.id,
        });
        return {
          success: false,
          transactions: [],
          error: `Invalid plugin settings: ${validationResult.errors?.join(", ")}`,
        };
      }

      const settings = config.settings as BaoEchpChargeSettings;

      // The worker (participant) is always the billed entity.
      const ea = await storage.ledger.ea.getOrCreate(
        "worker",
        hoursContext.workerId,
        settings.accountId,
      );
      const chargePluginKey = `${config.id}:${ea.id}:${hoursContext.hoursId}`;

      const expectedEntry = await this.computeExpectedEntry(
        hoursContext,
        config,
        settings,
        ea,
      );
      // All entries this config has posted against the hours row (base charge
      // plus any prior adjustments). The running balance is their sum — the
      // base entry's amount is never mutated, so reconciling against the net
      // total (not just the base entry) keeps repeated edits idempotent.
      const allEntries = await storage.ledger.entries.getByReferenceAndConfig(
        hoursContext.hoursId,
        config.id,
      );
      const netTotal = allEntries.reduce(
        (sum, e) => sum + parseFloat(e.amount),
        0,
      );
      const hasEntries = allEntries.length > 0;

      // No charge applies.
      if (!expectedEntry) {
        // Nothing exists — nothing to do.
        if (!hasEntries) {
          return {
            success: true,
            transactions: [],
            message: "No ECHP charge applicable",
          };
        }

        // The purchase no longer qualifies (hours cleared, status changed,
        // policy disabled): remove every entry posted for the hours row so the
        // net balance returns to zero.
        for (const entry of allEntries) {
          await storage.ledger.entries.delete(entry.id);
        }
        const removed = netTotal.toFixed(2);

        logger.info("Removing ECHP charge entries - no longer qualifying", {
          service: "charge-plugin-bao-echp",
          hoursId: hoursContext.hoursId,
          workerId: hoursContext.workerId,
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
              description: `ECHP charge removed: -$${removed}`,
            },
          ],
          message: "Deleted ECHP charge - no longer qualifying",
        };
      }

      // From here a charge applies (expectedEntry is non-null).
      // A brand-new qualifying purchase — create the base charge.
      if (!hasEntries) {
        const transaction: LedgerTransaction = {
          chargePlugin: this.metadata.id,
          chargePluginKey: expectedEntry.chargePluginKey,
          chargePluginConfigId: config.id,
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

        logger.info("Creating ECHP charge entry", {
          service: "charge-plugin-bao-echp",
          hoursId: hoursContext.hoursId,
          workerId: hoursContext.workerId,
          amount: expectedEntry.amount,
          year: hoursContext.year,
          month: hoursContext.month,
        });

        return {
          success: true,
          transactions: [transaction],
          notifications: [
            {
              type: "created" as const,
              amount: expectedEntry.amount,
              description: `ECHP charge created: $${expectedEntry.amount}`,
            },
          ],
          message: `Created ECHP charge for $${expectedEntry.amount}`,
        };
      }

      // Entries already exist. Reconcile the net posted total to the expected
      // amount with a single correcting delta. Idempotent: if the running
      // total already equals the expected amount, do nothing.
      const expectedAmount = parseFloat(expectedEntry.amount);
      const delta = Number((expectedAmount - netTotal).toFixed(2));
      if (Math.abs(delta) < 0.005) {
        return {
          success: true,
          transactions: [],
          message: "ECHP charge already matches expected state",
        };
      }

      const netTotalStr = netTotal.toFixed(2);
      const adjustmentAmount = delta.toFixed(2);
      const adjustmentKey = `${expectedEntry.chargePluginKey}:adj:${Date.now()}`;
      const signed = adjustmentAmount.startsWith("-")
        ? adjustmentAmount
        : `+${adjustmentAmount}`;
      const label = `${monthName(hoursContext.year, hoursContext.month)} ${hoursContext.year}`;
      const description = `ECHP Hours Purchase Adjustment: ${label} ($${netTotalStr} → $${expectedEntry.amount}, ${signed})`;

      const transaction: LedgerTransaction = {
        chargePlugin: this.metadata.id,
        chargePluginKey: adjustmentKey,
        chargePluginConfigId: config.id,
        accountId: settings.accountId,
        entityType: "worker",
        entityId: hoursContext.workerId,
        amount: adjustmentAmount,
        description,
        transactionDate: expectedEntry.transactionDate,
        referenceType: "hour_adjustment",
        referenceId: hoursContext.hoursId,
        metadata: {
          ...expectedEntry.metadata,
          adjustmentType: "amount_change",
          originalAmount: netTotalStr,
          newAmount: expectedEntry.amount,
        },
      };

      logger.info("Creating ECHP charge adjustment entry", {
        service: "charge-plugin-bao-echp",
        hoursId: hoursContext.hoursId,
        workerId: hoursContext.workerId,
        originalAmount: netTotalStr,
        newAmount: expectedEntry.amount,
        adjustmentAmount,
      });

      return {
        success: true,
        transactions: [transaction],
        notifications: [
          {
            type: "created" as const,
            amount: adjustmentAmount,
            description: `ECHP charge adjustment: $${netTotalStr} → $${expectedEntry.amount} (adjustment: $${adjustmentAmount})`,
          },
        ],
        message: `Created ECHP charge adjustment for $${adjustmentAmount}`,
      };
    } catch (error) {
      logger.error("BAO ECHP Charge plugin execution failed", {
        service: "charge-plugin-bao-echp",
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
      // Adjustment entries are self-describing: verify the delta matches the
      // recorded original/new amounts rather than recomputing pricing.
      if (entry.referenceType === "hour_adjustment") {
        const data = entry.data as {
          originalAmount?: string;
          newAmount?: string;
        } | null;

        if (!data?.originalAmount || !data?.newAmount) {
          return {
            ...baseResult,
            isValid: false,
            discrepancies: [
              "Adjustment entry missing required metadata (originalAmount, newAmount)",
            ],
          };
        }

        const expectedAdjustment = (
          parseFloat(data.newAmount) - parseFloat(data.originalAmount)
        ).toFixed(2);
        const discrepancies: string[] = [];
        if (entry.amount !== expectedAdjustment) {
          discrepancies.push(
            `Adjustment amount mismatch: expected ${expectedAdjustment}, found ${entry.amount}`,
          );
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
          discrepancies: [
            `Invalid plugin configuration: ${validationResult.errors?.join(", ")}`,
          ],
        };
      }

      const settings = config.settings as BaoEchpChargeSettings;

      if (!entry.referenceId) {
        return {
          ...baseResult,
          isValid: false,
          discrepancies: ["Entry has no referenceId - cannot verify"],
        };
      }

      const data = entry.data as {
        workerId?: string;
        year?: number;
        month?: number;
        hoursPurchased?: number;
        employmentStatusId?: string;
      } | null;

      if (!data?.workerId || !data?.year || !data?.month) {
        return {
          ...baseResult,
          isValid: false,
          discrepancies: [
            "Entry missing required metadata (workerId, year, month)",
          ],
        };
      }

      const echpStatusId = await this.resolveEchpStatusId();

      const hoursContext: HoursSavedContext = {
        trigger: TriggerType.HOURS_SAVED,
        hoursId: entry.referenceId,
        workerId: data.workerId,
        employerId: "",
        year: data.year,
        month: data.month,
        day: 1,
        hours: data.hoursPurchased ?? 0,
        employmentStatusId: echpStatusId ?? "",
        home: false,
      };

      const ea = await storage.ledger.ea.getOrCreate(
        "worker",
        data.workerId,
        settings.accountId,
      );

      const expectedEntry = await this.computeExpectedEntry(
        hoursContext,
        config,
        settings,
        ea,
      );

      if (!expectedEntry) {
        return {
          ...baseResult,
          isValid: false,
          expectedAmount: "0.00",
          expectedDescription: null,
          discrepancies: [
            "Entry exists but no charge expected - entry should be deleted",
          ],
        };
      }

      const discrepancies: string[] = [];

      // Account for any adjustment entries posted against the same hours row.
      const allEntriesForHours =
        await storage.ledger.entries.getByReferenceAndConfig(
          entry.referenceId,
          config.id,
        );
      const adjustmentEntries = allEntriesForHours.filter(
        (e) => e.referenceType === "hour_adjustment",
      );

      if (adjustmentEntries.length > 0) {
        const totalAmount = allEntriesForHours.reduce(
          (sum, e) => sum + parseFloat(e.amount),
          0,
        );
        const expectedAmount = parseFloat(expectedEntry.amount);
        if (Math.abs(totalAmount - expectedAmount) > 0.01) {
          discrepancies.push(
            `Total amount mismatch (base + ${adjustmentEntries.length} adjustment(s)): expected ${expectedEntry.amount}, total is ${totalAmount.toFixed(2)}`,
          );
        }
      } else if (entry.amount !== expectedEntry.amount) {
        discrepancies.push(
          `Amount mismatch: expected ${expectedEntry.amount}, found ${entry.amount}`,
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

registerChargePlugin(new BaoEchpChargePlugin());

export { BaoEchpChargePlugin };
