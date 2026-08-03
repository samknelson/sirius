import { ChargePlugin } from "../base";
import {
  TriggerType,
  PluginContext,
  PluginExecutionResult,
  PaymentSavedContext,
  LedgerTransaction,
  LedgerNotification,
  LedgerEntryVerification,
} from "../types";
import { registerChargePlugin } from "../registry";
import type { ChargePluginMetadata } from "../types";
import { logger } from "../../../../logger";
import { storage } from "../../../../storage";
import {
  UPLOAD_ALREADY_CONSUMED,
  type BaoWithholdingAllocation,
} from "../../../../storage/sitespecific/bao/withholding-allocations";
import type { Ledger, ChargePluginConfig } from "@shared/schema";

const SERVICE = "charge-plugin-bao-er-report-to-ee-allocation";
const PLUGIN_ID = "bao-er-report-to-ee-allocation";

/**
 * Resolve THE single canonical BAO upload-source config for a ledger
 * account. Only global-scope configs qualify (payment execution dispatches
 * without an employer scope), and duplicates are disambiguated
 * deterministically by id so that exactly one config ever credits workers —
 * duplicate enabled configs must not double-credit. Used by BOTH payment
 * validation and plugin execution so the two can never disagree.
 */
export async function resolveBaoUploadSourceConfig(
  accountId: string,
): Promise<{ id: string } | null> {
  const envs: any[] = await storage.pluginConfigs.search("charge", {
    pluginId: PLUGIN_ID,
    enabled: true,
  });
  const matches = envs
    .filter((e) => e.subsidiary?.scope === "global" && e.subsidiary?.account === accountId)
    .sort((a, b) => (a.config.id < b.config.id ? -1 : 1));
  return matches[0]?.config ?? null;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

interface UploadSourceMarker {
  wizardIds: string[];
}

function readUploadSource(details: unknown): UploadSourceMarker | null {
  const marker = (details as Record<string, unknown> | null | undefined)?.baoUploadSource;
  if (!marker || typeof marker !== "object" || Array.isArray(marker)) return null;
  const wizardIds = (marker as Record<string, unknown>).wizardIds;
  if (!Array.isArray(wizardIds) || wizardIds.length === 0) return null;
  return { wizardIds: wizardIds.filter((w): w is string => typeof w === "string" && !!w) };
}

/**
 * BAO "ER report to EE Allocation" charge plugin.
 *
 * When an employer payment carrying `details.baoUploadSource` (one or more
 * BAO Monthly Hours uploads selected as the allocation source) is CLEARED on
 * the configured account, this plugin race-safely consumes the uploads'
 * stored withholding allocations and expands them into one per-worker ledger
 * entry crediting each worker's EA, keyed idempotently on
 * `config:payment:wizard:worker`. When the payment is voided or edited away
 * from cleared (or the upload selection changes), stale entries are removed
 * and the uploads are released for selection by another payment — following
 * the payment-simple-allocation reconcile model.
 */
class BaoErReportToEeAllocationPlugin extends ChargePlugin {
  readonly metadata: ChargePluginMetadata = {
    id: "bao-er-report-to-ee-allocation",
    name: "BAO ER report to EE Allocation",
    description:
      "Expands an employer payment funded by BAO Monthly Hours upload withholding into per-worker ledger credits when the payment clears; reverses them and releases the uploads when the payment is voided.",
    triggers: [TriggerType.PAYMENT_SAVED],
    defaultScope: "global" as const,
    configSchema: { type: "object", properties: {} },
    requiredComponent: "sitespecific.bao",
  };

  private buildExpectedEntries(
    paymentContext: PaymentSavedContext,
    configId: string,
    allocations: BaoWithholdingAllocation[],
  ): LedgerTransaction[] {
    const transactionDate =
      paymentContext.dateCleared || paymentContext.dateReceived || new Date();
    return allocations.map((a) => {
      const ym = `${a.year}-${pad2(a.month)}`;
      return {
        chargePlugin: this.metadata.id,
        chargePluginKey: `${configId}:${paymentContext.paymentId}:${a.wizardId}:${a.workerId}`,
        chargePluginConfigId: configId,
        accountId: paymentContext.accountId,
        entityType: "worker",
        entityId: a.workerId,
        amount: (-parseFloat(a.amount)).toFixed(2),
        description: `BAO employee withholding for ${ym} (employer payment)`,
        memo: `BAO employee withholding for ${ym} (employer payment)`,
        transactionDate,
        statementYmd: `${ym}-01`,
        referenceType: "payment",
        referenceId: paymentContext.paymentId,
        metadata: {
          pluginId: this.metadata.id,
          pluginConfigId: configId,
          paymentId: paymentContext.paymentId,
          wizardId: a.wizardId,
          workerId: a.workerId,
          workerEaId: a.workerEaId,
          allocationId: a.id,
          ym,
        },
      };
    });
  }

  async execute(context: PluginContext, config: any): Promise<PluginExecutionResult> {
    if (context.trigger !== TriggerType.PAYMENT_SAVED) {
      return {
        success: false,
        transactions: [],
        error: `BAO ER report to EE Allocation plugin only handles PAYMENT_SAVED trigger, got ${context.trigger}`,
      };
    }
    const paymentContext = context as PaymentSavedContext;

    try {
      if (!config.account) {
        return { success: true, transactions: [], message: "No ledger account configured for this charge plugin" };
      }
      if (config.account !== paymentContext.accountId) {
        return { success: true, transactions: [], message: "Payment account does not match configured account" };
      }
      // Per-allocation (participant) dispatches never carry upload sources;
      // reconcile only on the whole-payment dispatch.
      if (paymentContext.allocationId) {
        return { success: true, transactions: [], message: "Participant allocation dispatch — not applicable" };
      }

      const marker = readUploadSource(paymentContext.details);

      // Only the canonical config for this account may credit workers.
      // Non-canonical invocations (duplicate enabled configs) reconcile
      // their own entries to zero and never touch upload consumption.
      const canonical = await resolveBaoUploadSourceConfig(paymentContext.accountId);
      const isCanonical = canonical?.id === config.id;

      const existingEntries = (
        await storage.ledger.entries.getByReferenceAndConfig(paymentContext.paymentId, config.id)
      ).filter((e) => e.chargePlugin === this.metadata.id);
      const notifications: LedgerNotification[] = [];

      const deleteEntries = async (entries: Ledger[]) => {
        for (const entry of entries) {
          await storage.ledger.entries.delete(entry.id);
          logger.info("Deleted BAO upload-source worker entry", {
            service: SERVICE,
            paymentId: paymentContext.paymentId,
            deletedEntryId: entry.id,
            chargePluginKey: entry.chargePluginKey,
          });
        }
        if (entries.length > 0) {
          const total = entries.reduce((s, e) => s + Math.abs(parseFloat(e.amount)), 0);
          notifications.push({
            type: "deleted",
            amount: (-total).toFixed(2),
            description: `Reversed ${entries.length} worker withholding entry(s): -$${total.toFixed(2)}`,
          });
        }
      };

      if (!isCanonical) {
        await deleteEntries(existingEntries);
        return {
          success: true,
          transactions: [],
          notifications,
          message: "Not the canonical BAO upload-source config for this account — no entries kept",
        };
      }

      // No marker, or payment no longer cleared: reverse everything we own
      // for this payment and release the uploads it held.
      if (!marker || paymentContext.status !== "cleared") {
        await deleteEntries(existingEntries);
        await storage.baoWithholdingAllocations.release(paymentContext.paymentId);
        return {
          success: true,
          transactions: [],
          notifications,
          message: !marker
            ? "Payment carries no upload source"
            : `Payment status is ${paymentContext.status} — worker entries reversed and uploads released`,
        };
      }

      // Cleared payment with upload sources: consume race-safely, then
      // reconcile per-worker entries against the allocation set returned
      // from the locked consume transaction (a concurrent upload rewrite
      // cannot change what this payment funds).
      let allocations: BaoWithholdingAllocation[];
      try {
        allocations = await storage.baoWithholdingAllocations.consume(
          marker.wizardIds,
          paymentContext.paymentId,
        );
      } catch (err) {
        if (err instanceof Error && err.message === UPLOAD_ALREADY_CONSUMED) {
          return {
            success: false,
            transactions: [],
            error: "A selected upload has already been consumed by another payment",
          };
        }
        throw err;
      }

      const expected = this.buildExpectedEntries(paymentContext, config.id, allocations);
      const expectedByKey = new Map(expected.map((t) => [t.chargePluginKey, t]));

      const keptKeys = new Set<string>();
      const stale: Ledger[] = [];
      for (const entry of existingEntries) {
        const match = entry.chargePluginKey ? expectedByKey.get(entry.chargePluginKey) : undefined;
        if (match && entry.amount === match.amount) {
          keptKeys.add(entry.chargePluginKey!);
        } else {
          stale.push(entry);
        }
      }
      await deleteEntries(stale);

      const transactions = expected.filter((t) => !keptKeys.has(t.chargePluginKey));
      if (transactions.length > 0) {
        const total = transactions.reduce((s, t) => s + Math.abs(parseFloat(t.amount)), 0);
        notifications.push({
          type: "created",
          amount: (-total).toFixed(2),
          description: `Created ${transactions.length} worker withholding entry(s): -$${total.toFixed(2)}`,
        });
      }

      return {
        success: true,
        transactions,
        notifications,
        message:
          transactions.length > 0
            ? `Allocated ${transactions.length} worker withholding entry(s) from ${marker.wizardIds.length} upload(s)`
            : "Worker withholding entries already up to date",
      };
    } catch (error) {
      logger.error("BAO ER report to EE Allocation plugin execution failed", {
        service: SERVICE,
        paymentId: paymentContext.paymentId,
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
        return { ...baseResult, isValid: false, discrepancies: ["Entry has no referenceId - cannot verify"] };
      }
      const payment = await storage.ledger.payments.get(entry.referenceId);
      if (!payment) {
        return {
          ...baseResult,
          isValid: false,
          discrepancies: [`Referenced payment ${entry.referenceId} no longer exists - orphaned entry`],
        };
      }
      if (payment.status !== "cleared") {
        return {
          ...baseResult,
          isValid: false,
          expectedAmount: "0.00",
          discrepancies: [`Entry exists but payment status is "${payment.status}" (not "cleared") - entry should be deleted`],
        };
      }
      const marker = readUploadSource(payment.details);
      if (!marker) {
        return {
          ...baseResult,
          isValid: false,
          discrepancies: ["Referenced payment no longer carries an upload source - entry should be deleted"],
        };
      }
      const meta = (entry.data || {}) as Record<string, unknown>;
      const wizardId = typeof meta.wizardId === "string" ? meta.wizardId : null;
      const workerId = typeof meta.workerId === "string" ? meta.workerId : null;
      if (!wizardId || !workerId || !marker.wizardIds.includes(wizardId)) {
        return {
          ...baseResult,
          isValid: false,
          discrepancies: ["Entry's upload is no longer part of the payment's selected sources"],
        };
      }
      const allocations = await storage.baoWithholdingAllocations.getByWizard(wizardId);
      const allocation = allocations.find((a) => a.workerId === workerId);
      if (!allocation) {
        return {
          ...baseResult,
          isValid: false,
          discrepancies: ["No stored withholding allocation exists for this upload+worker"],
        };
      }
      const expectedAmount = (-parseFloat(allocation.amount)).toFixed(2);
      const discrepancies: string[] = [];
      if (entry.amount !== expectedAmount) {
        discrepancies.push(`Amount mismatch: expected ${expectedAmount}, found ${entry.amount}`);
      }
      if (allocation.consumedByPaymentId !== payment.id) {
        discrepancies.push("Allocation is not marked consumed by this payment");
      }
      return { ...baseResult, isValid: discrepancies.length === 0, expectedAmount, discrepancies };
    } catch (error) {
      return {
        ...baseResult,
        isValid: false,
        discrepancies: [`Verification error: ${error instanceof Error ? error.message : String(error)}`],
      };
    }
  }
}

registerChargePlugin(new BaoErReportToEeAllocationPlugin());
