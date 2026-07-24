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
import type { ChargePluginMetadata } from "../types";
import { logger } from "../../../../logger";
import { storage } from "../../../../storage/database";
import type { Ledger, ChargePluginConfig, BaoPremiumCoverageTier } from "@shared/schema";

const SERVICE = "charge-plugin-sitespecific-bao-premium";

interface ExpectedEntry {
  chargePluginKey: string;
  amount: string;
  description: string;
  transactionDate: Date;
  statementYmd: string;
  eaId: string;
  providerId: string;
  referenceType: string;
  referenceId: string;
  metadata: Record<string, any>;
}

/**
 * BAO provider premium accounting.
 *
 * When a worker-month-benefit (WMB) row is saved for a benefit that is linked
 * to a trust provider, this plugin charges that provider's entity account the
 * effective monthly premium for the worker's coverage tier (1 / 2 / 3+
 * covered people, derived from the worker's active trust election as of the
 * first of the benefit month). The entry's statement month is the benefit
 * month, so premium files can settle whole months at a time.
 *
 * Idempotent per (config, provider EA, worker, benefit, year, month): re-runs
 * update the existing entry when the tier or rate changed, and deleting the
 * WMB deletes the charge.
 */
class SitespecificBaoPremiumPlugin extends ChargePlugin {
  readonly metadata: ChargePluginMetadata = {
    id: "sitespecific-bao-premium",
    name: "BAO Provider Premium",
    description:
      "Charges the trust provider linked to a benefit the effective monthly premium (by coverage tier 1/2/3+) whenever a worker-month-benefit is saved. Statement month = benefit month.",
    triggers: [TriggerType.WMB_SAVED],
    defaultScope: "global" as const,
    configSchema: {
      type: "object",
      properties: {},
    },
    requiredComponent: "sitespecific.bao",
  };

  private async resolveCoverageTier(
    workerId: string,
    asOfYmd: string,
  ): Promise<{ tier: BaoPremiumCoverageTier; coveredCount: number }> {
    const election = await storage.workerTrustElections.getActiveByWorkerAsOf(
      workerId,
      asOfYmd,
    );
    const coveredCount = 1 + (election?.relationshipIds?.length ?? 0);
    const tier: BaoPremiumCoverageTier =
      coveredCount >= 3 ? "3+" : coveredCount === 2 ? "2" : "1";
    return { tier, coveredCount };
  }

  private async computeExpectedEntry(
    wmbContext: WmbSavedContext,
    config: any,
  ): Promise<ExpectedEntry | null> {
    if (!config.account) {
      return null;
    }
    if (wmbContext.isDeleted) {
      return null;
    }

    const benefit = await storage.trustBenefits.getTrustBenefit(wmbContext.benefitId);
    if (!benefit?.providerId) {
      return null;
    }

    const monthStr = String(wmbContext.month).padStart(2, "0");
    const statementYmd = `${wmbContext.year}-${monthStr}-01`;

    const { tier, coveredCount } = await this.resolveCoverageTier(
      wmbContext.workerId,
      statementYmd,
    );

    const rate = await storage.baoPremiumRates.getEffectiveRate(
      wmbContext.benefitId,
      tier,
      statementYmd,
    );
    if (!rate || Number(rate.rate) === 0) {
      return null;
    }

    const ea = await storage.ledger.ea.getOrCreate(
      "trust_provider",
      benefit.providerId,
      config.account,
    );

    // NOTE: the key deliberately excludes the provider/entity-account id so
    // that when a benefit is re-linked to a different provider, the existing
    // entry is found and moved (delete + recreate) instead of stranding a
    // charge on the old provider's account.
    const chargePluginKey = `${config.id}:${wmbContext.workerId}:${wmbContext.benefitId}:${wmbContext.year}:${wmbContext.month}`;

    let workerName = "";
    const worker = await storage.workers.getWorker(wmbContext.workerId);
    if (worker) {
      const contact = await storage.contacts.getContact(worker.contactId);
      if (contact?.displayName) {
        workerName = contact.displayName;
      }
    }

    const benefitYearMonth = `${wmbContext.year}-${monthStr}`;
    const description = workerName
      ? `Premium ${benefit.name} - ${benefitYearMonth} | ${workerName} | Tier ${tier}`
      : `Premium ${benefit.name} - ${benefitYearMonth} | Tier ${tier}`;

    return {
      chargePluginKey,
      amount: Number(rate.rate).toFixed(2),
      description,
      transactionDate: new Date(wmbContext.year, wmbContext.month - 1, 1),
      statementYmd,
      eaId: ea.id,
      providerId: benefit.providerId,
      referenceType: "wmb",
      referenceId: wmbContext.wmbId,
      metadata: {
        pluginId: this.metadata.id,
        pluginConfigId: config.id,
        workerId: wmbContext.workerId,
        employerId: wmbContext.employerId,
        benefitId: wmbContext.benefitId,
        providerId: benefit.providerId,
        benefitYear: wmbContext.year,
        benefitMonth: wmbContext.month,
        coverageTier: tier,
        coveredCount,
        rate: Number(rate.rate),
        rateEffectiveYmd: rate.effectiveYmd,
      },
    };
  }

  async execute(context: PluginContext, config: any): Promise<PluginExecutionResult> {
    if (context.trigger !== TriggerType.WMB_SAVED) {
      return {
        success: false,
        transactions: [],
        error: `BAO Provider Premium plugin only handles WMB_SAVED trigger, got ${context.trigger}`,
      };
    }

    const wmbContext = context as WmbSavedContext;

    try {
      if (!config.account) {
        return {
          success: true,
          transactions: [],
          message: "No ledger account configured for this charge plugin",
        };
      }

      if (!(await storage.baoPremiumRates.tableExists())) {
        return {
          success: true,
          transactions: [],
          message: "Premium rates table not present (BAO component not fully enabled)",
        };
      }

      const chargePluginKey = `${config.id}:${wmbContext.workerId}:${wmbContext.benefitId}:${wmbContext.year}:${wmbContext.month}`;

      const expectedEntry = await this.computeExpectedEntry(wmbContext, config);
      const existingEntry = await storage.ledger.entries.getByChargePluginKey(
        this.metadata.id,
        chargePluginKey,
      );

      if (!expectedEntry && !existingEntry) {
        return {
          success: true,
          transactions: [],
          message: "No premium charge applicable",
        };
      }

      if (!expectedEntry && existingEntry) {
        await storage.ledger.entries.deleteByChargePluginKey(
          this.metadata.id,
          chargePluginKey,
        );
        logger.info("Deleted premium ledger entry - no longer applies", {
          service: SERVICE,
          wmbId: wmbContext.wmbId,
          deletedEntryId: existingEntry.id,
          previousAmount: existingEntry.amount,
        });
        const notification: LedgerNotification = {
          type: "deleted",
          amount: existingEntry.amount,
          description: `Premium entry deleted: -$${existingEntry.amount}`,
        };
        return {
          success: true,
          transactions: [],
          notifications: [notification],
          message: "Deleted premium ledger entry - no longer applies",
        };
      }

      if (expectedEntry && !existingEntry) {
        const transaction: LedgerTransaction = {
          chargePlugin: this.metadata.id,
          chargePluginKey: expectedEntry.chargePluginKey,
          chargePluginConfigId: config.id,
          accountId: config.account,
          entityType: "trust_provider",
          entityId: expectedEntry.providerId,
          amount: expectedEntry.amount,
          description: expectedEntry.description,
          transactionDate: expectedEntry.transactionDate,
          statementYmd: expectedEntry.statementYmd,
          referenceType: expectedEntry.referenceType,
          referenceId: expectedEntry.referenceId,
          metadata: expectedEntry.metadata,
        };
        logger.info("Creating premium ledger entry", {
          service: SERVICE,
          wmbId: wmbContext.wmbId,
          amount: expectedEntry.amount,
          providerId: expectedEntry.providerId,
          statementYmd: expectedEntry.statementYmd,
        });
        const notification: LedgerNotification = {
          type: "created",
          amount: expectedEntry.amount,
          description: `Premium entry created: $${expectedEntry.amount}`,
        };
        return {
          success: true,
          transactions: [transaction],
          notifications: [notification],
          message: `Created premium entry for $${expectedEntry.amount} - ${expectedEntry.description}`,
        };
      }

      if (expectedEntry && existingEntry && existingEntry.eaId !== expectedEntry.eaId) {
        // The benefit was re-linked to a different provider (or the entity
        // account changed): move the charge by deleting the old entry and
        // creating a fresh one on the new provider's account.
        await storage.ledger.entries.deleteByChargePluginKey(
          this.metadata.id,
          chargePluginKey,
        );
        const transaction: LedgerTransaction = {
          chargePlugin: this.metadata.id,
          chargePluginKey: expectedEntry.chargePluginKey,
          chargePluginConfigId: config.id,
          accountId: config.account,
          entityType: "trust_provider",
          entityId: expectedEntry.providerId,
          amount: expectedEntry.amount,
          description: expectedEntry.description,
          transactionDate: expectedEntry.transactionDate,
          statementYmd: expectedEntry.statementYmd,
          referenceType: expectedEntry.referenceType,
          referenceId: expectedEntry.referenceId,
          metadata: expectedEntry.metadata,
        };
        logger.info("Moved premium ledger entry to new provider account", {
          service: SERVICE,
          wmbId: wmbContext.wmbId,
          previousEaId: existingEntry.eaId,
          newEaId: expectedEntry.eaId,
          amount: expectedEntry.amount,
        });
        const notification: LedgerNotification = {
          type: "updated",
          amount: expectedEntry.amount,
          previousAmount: existingEntry.amount,
          description: `Premium entry moved to new provider account: $${expectedEntry.amount}`,
        };
        return {
          success: true,
          transactions: [transaction],
          notifications: [notification],
          message: "Moved premium ledger entry to the benefit's current provider account",
        };
      }

      if (expectedEntry && existingEntry) {
        const amountChanged = existingEntry.amount !== expectedEntry.amount;
        const memoChanged = existingEntry.memo !== expectedEntry.description;
        const referenceIdChanged = existingEntry.referenceId !== expectedEntry.referenceId;

        if (!amountChanged && !memoChanged && !referenceIdChanged) {
          return {
            success: true,
            transactions: [],
            message: "Premium ledger entry already matches expected state",
          };
        }

        await storage.ledger.entries.update(existingEntry.id, {
          amount: expectedEntry.amount,
          memo: expectedEntry.description,
          referenceType: expectedEntry.referenceType,
          referenceId: expectedEntry.referenceId,
          data: expectedEntry.metadata,
        });
        logger.info("Updated premium ledger entry", {
          service: SERVICE,
          wmbId: wmbContext.wmbId,
          entryId: existingEntry.id,
          previousAmount: existingEntry.amount,
          newAmount: expectedEntry.amount,
        });
        const notification: LedgerNotification = {
          type: "updated",
          amount: expectedEntry.amount,
          previousAmount: existingEntry.amount,
          description: amountChanged
            ? `Premium entry updated: $${existingEntry.amount} → $${expectedEntry.amount}`
            : `Premium entry updated: $${expectedEntry.amount}`,
        };
        return {
          success: true,
          transactions: [],
          notifications: [notification],
          message: "Updated premium ledger entry",
        };
      }

      return { success: true, transactions: [], message: "No action taken" };
    } catch (error) {
      logger.error("BAO Provider Premium plugin execution failed", {
        service: SERVICE,
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

  async verifyEntry(entry: Ledger, config: ChargePluginConfig): Promise<LedgerEntryVerification> {
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
        benefitYear?: number;
        benefitMonth?: number;
      } | null;

      if (!data?.workerId || !data?.benefitId || !data?.benefitYear || !data?.benefitMonth) {
        return {
          ...baseResult,
          isValid: false,
          discrepancies: [
            "Entry missing required metadata (workerId, benefitId, benefitYear, benefitMonth)",
          ],
        };
      }

      const wmbContext: WmbSavedContext = {
        trigger: TriggerType.WMB_SAVED,
        wmbId: entry.referenceId,
        workerId: data.workerId,
        employerId: data.employerId ?? "",
        benefitId: data.benefitId,
        year: data.benefitYear,
        month: data.benefitMonth,
      };

      const expectedEntry = await this.computeExpectedEntry(wmbContext, config);

      if (!expectedEntry) {
        return {
          ...baseResult,
          isValid: false,
          expectedAmount: "0.00",
          expectedDescription: null,
          discrepancies: [
            "Entry exists but premium no longer applies - entry should be deleted",
          ],
        };
      }

      const discrepancies: string[] = [];
      if (entry.amount !== expectedEntry.amount) {
        discrepancies.push(
          `Amount mismatch: expected ${expectedEntry.amount}, found ${entry.amount}`,
        );
      }
      if (entry.memo !== expectedEntry.description) {
        discrepancies.push(
          `Description mismatch: expected "${expectedEntry.description}", found "${entry.memo}"`,
        );
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
        discrepancies: [
          `Verification error: ${error instanceof Error ? error.message : String(error)}`,
        ],
      };
    }
  }
}

registerChargePlugin(new SitespecificBaoPremiumPlugin());
