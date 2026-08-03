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
 * Premium charges are keyed to SUBSCRIBERS only. When a worker-month-benefit
 * (WMB) row is saved or deleted for a benefit linked to a trust provider:
 *
 * - Subscriber rows (source_relation_id NULL) recompute the subscriber's own
 *   charge.
 * - Dependent rows (source_relation_id set) never get their own charge;
 *   instead the source relation's subscriber (worker_1) is resolved and THAT
 *   subscriber's charge is recomputed for the same benefit/month.
 *
 * The coverage tier (1 / 2 / 3+) is derived from live WMB rows: the
 * subscriber themselves plus every dependent WMB row whose source relation
 * points back at the subscriber for that benefit/month. If dependents have
 * rows but the subscriber has none, the subscriber is still charged and the
 * entry is flagged (orphanSubscriberWmb metadata + "NO SUBSCRIBER WMB" memo
 * marker, surfaced on premium file rows) so the anomaly is not silent.
 *
 * Idempotent per (config, worker, benefit, year, month): re-runs update the
 * existing entry when the tier or rate changed, and when the last coverage
 * row for a month is deleted the charge is deleted.
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

  private async computeExpectedEntry(
    subscriberWorkerId: string,
    benefitId: string,
    year: number,
    month: number,
    fallbackEmployerId: string,
    config: any,
  ): Promise<ExpectedEntry | null> {
    if (!config.account) {
      return null;
    }

    const benefit = await storage.trustBenefits.getTrustBenefit(benefitId);
    if (!benefit?.providerId) {
      return null;
    }

    // Tier from live WMB rows: subscriber's own row plus dependent rows whose
    // source relation points back at the subscriber, for this benefit/month.
    const coverage = await storage.trust.wmb.getPremiumCoverage(
      subscriberWorkerId,
      benefitId,
      month,
      year,
    );
    const dependentCount = coverage.dependentWmbIds.length;
    if (!coverage.ownWmbId && dependentCount === 0) {
      // No coverage rows at all — no charge (existing entry gets deleted).
      return null;
    }

    // The subscriber is always counted, even when they have no own WMB row
    // (orphan-dependent state — flagged below so it isn't silent).
    const coveredCount = 1 + dependentCount;
    const tier: BaoPremiumCoverageTier =
      coveredCount >= 3 ? "3+" : coveredCount === 2 ? "2" : "1";
    const orphanSubscriberWmb = !coverage.ownWmbId;

    const monthStr = String(month).padStart(2, "0");
    const statementYmd = `${year}-${monthStr}-01`;

    const rate = await storage.baoPremiumRates.getEffectiveRate(
      benefitId,
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
    const chargePluginKey = `${config.id}:${subscriberWorkerId}:${benefitId}:${year}:${month}`;

    let workerName = "";
    const worker = await storage.workers.getWorker(subscriberWorkerId);
    if (worker) {
      const contact = await storage.contacts.getContact(worker.contactId);
      if (contact?.displayName) {
        workerName = contact.displayName;
      }
    }

    const benefitYearMonth = `${year}-${monthStr}`;
    let description = workerName
      ? `Premium ${benefit.name} - ${benefitYearMonth} | ${workerName} | Tier ${tier}`
      : `Premium ${benefit.name} - ${benefitYearMonth} | Tier ${tier}`;
    if (orphanSubscriberWmb) {
      description += " | NO SUBSCRIBER WMB";
    }

    return {
      chargePluginKey,
      amount: Number(rate.rate).toFixed(2),
      description,
      transactionDate: new Date(year, month - 1, 1),
      statementYmd,
      eaId: ea.id,
      providerId: benefit.providerId,
      referenceType: "wmb",
      // Anchor on the subscriber's own row; in the orphan state, on the
      // first dependent row (deleting it re-triggers a recompute anyway).
      referenceId: coverage.ownWmbId ?? coverage.dependentWmbIds[0],
      metadata: {
        pluginId: this.metadata.id,
        pluginConfigId: config.id,
        workerId: subscriberWorkerId,
        employerId: coverage.employerId ?? fallbackEmployerId,
        benefitId,
        providerId: benefit.providerId,
        benefitYear: year,
        benefitMonth: month,
        coverageTier: tier,
        coveredCount,
        dependentWmbCount: dependentCount,
        orphanSubscriberWmb,
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

      // Dependent WMB rows never get their own charge: resolve the source
      // relation's subscriber (worker_1) and recompute THAT subscriber's
      // charge for the same benefit/month instead.
      let subscriberWorkerId = wmbContext.workerId;
      if (wmbContext.sourceRelationId) {
        const relation = await storage.workerRelations.get(wmbContext.sourceRelationId);
        if (!relation) {
          logger.warn(
            "Dependent WMB has an unresolvable source relation; skipping premium recompute",
            {
              service: SERVICE,
              wmbId: wmbContext.wmbId,
              sourceRelationId: wmbContext.sourceRelationId,
            },
          );
          return {
            success: true,
            transactions: [],
            message: "Dependent WMB source relation not found - no premium action",
          };
        }
        subscriberWorkerId = relation.worker1;

        // Self-heal: before the subscriber-only rework, dependent WMB saves
        // created charges keyed to the DEPENDENT worker. When a dependent
        // event comes through, delete any such legacy entry for the same
        // benefit/month so it cannot double-bill alongside the subscriber's
        // recomputed charge — unless it was already swept into a premium
        // file (deleting a settled charge would unbalance the payment; those
        // are left for manual review).
        if (subscriberWorkerId !== wmbContext.workerId) {
          const legacyKey = `${config.id}:${wmbContext.workerId}:${wmbContext.benefitId}:${wmbContext.year}:${wmbContext.month}`;
          const legacyEntry = await storage.ledger.entries.getByChargePluginKey(
            this.metadata.id,
            legacyKey,
          );
          if (legacyEntry) {
            const legacyStatementYmd = `${wmbContext.year}-${String(wmbContext.month).padStart(2, "0")}-01`;
            const swept = await storage.baoPremiumFiles.isMonthSwept(
              legacyEntry.eaId,
              wmbContext.workerId,
              wmbContext.benefitId,
              legacyStatementYmd,
            );
            if (swept) {
              // The legacy dependent-keyed charge was already settled by a
              // premium file. Creating a subscriber-keyed charge for the same
              // coverage month would bill it a second time (the settled pair
              // nets to zero; a new charge is an additional unpaid group), so
              // stop here entirely and leave this config-month for manual
              // review.
              logger.warn(
                "Legacy dependent-keyed premium entry already swept into a premium file; skipping subscriber recompute for this month - manual review required",
                {
                  service: SERVICE,
                  legacyEntryId: legacyEntry.id,
                  legacyKey,
                  dependentWorkerId: wmbContext.workerId,
                  subscriberWorkerId,
                  benefitId: wmbContext.benefitId,
                  year: wmbContext.year,
                  month: wmbContext.month,
                },
              );
              return {
                success: true,
                transactions: [],
                message:
                  "Legacy dependent-keyed premium already settled by a premium file - subscriber recompute skipped (manual review required)",
              };
            } else {
              await storage.ledger.entries.deleteByChargePluginKey(
                this.metadata.id,
                legacyKey,
              );
              logger.info("Deleted legacy dependent-keyed premium entry", {
                service: SERVICE,
                legacyEntryId: legacyEntry.id,
                legacyKey,
                dependentWorkerId: wmbContext.workerId,
                subscriberWorkerId,
                amount: legacyEntry.amount,
              });
            }
          }
        }
      }

      const chargePluginKey = `${config.id}:${subscriberWorkerId}:${wmbContext.benefitId}:${wmbContext.year}:${wmbContext.month}`;

      const expectedEntry = await this.computeExpectedEntry(
        subscriberWorkerId,
        wmbContext.benefitId,
        wmbContext.year,
        wmbContext.month,
        wmbContext.employerId,
        config,
      );
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
        // Metadata drives the premium-file sweep (workerId/benefitId grouping,
        // orphan flag) — refresh it whenever it drifts, even when the billed
        // amount happens to match (e.g. legacy election-derived metadata).
        const metadataChanged =
          JSON.stringify(existingEntry.data ?? null) !==
          JSON.stringify(expectedEntry.metadata);

        if (!amountChanged && !memoChanged && !referenceIdChanged && !metadataChanged) {
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

      const expectedEntry = await this.computeExpectedEntry(
        data.workerId,
        data.benefitId,
        data.benefitYear,
        data.benefitMonth,
        data.employerId ?? "",
        config,
      );

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
