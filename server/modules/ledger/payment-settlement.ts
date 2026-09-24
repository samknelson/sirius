import { randomUUID } from "node:crypto";
import type { LedgerPaymentAttempt } from "@shared/schema";
import type { NormalizedGatewayEvent, NormalizedPayment } from "../../plugins/ledger/payment-gateway/types";
import { storage } from "../../storage";
import { runInTransaction } from "../../storage/transaction-context";
import { createUnifiedOptionsStorage } from "../../storage/unified-options";
import { resolveGateway } from "./payment-gateway-context";
import { createPaymentFromRequestBody, triggerPaymentChargePlugins } from "./payments";
import { paymentEventMatchesAmount, selectFinancialPaymentType, shouldApplyPaymentEvent } from "./payment-attempt-state";
import { storageLogger } from "../../logger";
import { checkoutMinor, type CheckoutCreditTransfer } from "@shared/ledger/checkout-selection";

type Evidence = Omit<Pick<NormalizedGatewayEvent, "type" | "providerRef" | "amountMinor" | "currency" | "methodRef" | "methodSummary" | "providerCreated" | "failureCode">, "type"> & {
  type: NormalizedGatewayEvent["type"] | "payment.created" | "payment.requires_action";
};
const types = createUnifiedOptionsStorage();

/** Never persist provider error bodies or customer data in the inbox or logs. */
export function settlementError(error: unknown): string {
  if (error instanceof SettlementRefusal) return error.message;
  return "Payment settlement could not be completed; retry required";
}

export class SettlementRefusal extends Error {}

export function evidenceFromPayment(payment: NormalizedPayment): Evidence {
  return {
    type: `payment.${payment.status}` as Evidence["type"],
    providerRef: payment.providerRef, amountMinor: payment.amountMinor,
    currency: payment.currency, methodRef: payment.methodRef,
    methodSummary: payment.methodSummary, failureCode: payment.failureCode,
  };
}

/**
 * This is the only transition from provider evidence to a cleared ledger row.
 * The attempt lock covers the status, payment insert, allocation writes and
 * link, including concurrent webhook/cancel/reconciliation processes.
 */
export async function settlePayment(attemptId: string, gatewayId: string, evidence: Evidence): Promise<"applied" | "stale"> {
  const status = evidence.type === "payment.succeeded" ? "succeeded"
    : evidence.type === "payment.processing" ? "processing"
      : evidence.type === "payment.failed" ? "failed"
        : evidence.type === "payment.canceled" ? "canceled"
          : evidence.type === "payment.created" ? "created"
            : evidence.type === "payment.requires_action" ? "requires_action" : null;
  if (!status) throw new SettlementRefusal("Unsupported payment event");
  return runInTransaction(async () => {
    await storage.ledger.paymentAttempts.lockAttempt(attemptId);
    const attempt = await storage.ledger.paymentAttempts.get(attemptId);
    if (!attempt) throw new SettlementRefusal("Payment attempt not found");
    // Serialize posting/reservation release with checkout's balance quote.
    await storage.ledger.paymentAttempts.lockEa(attempt.ledgerEaId);
    if (attempt.gatewayConfigId !== gatewayId) throw new SettlementRefusal("Payment gateway mismatch");
    if (!evidence.providerRef || (attempt.providerIntentRef && attempt.providerIntentRef !== evidence.providerRef)) {
      throw new SettlementRefusal("Payment reference mismatch");
    }
    // Validate all outcomes, not only successes: a forged/incorrect failure
    // must not release the reservation of a different amount.
    if (!paymentEventMatchesAmount(attempt, evidence)) throw new SettlementRefusal("Payment amount or currency mismatch");
    if (!shouldApplyPaymentEvent(attempt.status, attempt.lastProviderEventCreated, status, evidence.providerCreated)) return "stale";
    if (status === "succeeded" && !attempt.ledgerPaymentId) {
      const options = await types.list("ledger-payment-type");
      const preferred = (attempt.metadata as Record<string, unknown> | null)?.ledgerPaymentTypeId;
      const paymentType = options.find(t => t.id === preferred && t.category === "financial" &&
        t.direction === "credit" &&
        t.currencyCode?.toUpperCase() === attempt.currency.toUpperCase()) ??
        selectFinancialPaymentType(options, attempt.currency);
      if (!paymentType) throw new SettlementRefusal("No financial ledger payment type is configured");
      const selection = attempt.statementSelection as Array<{ invoiceNumber: string; amount: string }> | null;
      const allocations = selection?.length
        ? selection.map(s => ({ eaId: attempt.ledgerEaId, amount: String(s.amount), statementYmd: s.invoiceNumber }))
        : [{ eaId: attempt.ledgerEaId, amount: attempt.amount, statementYmd: "" }];
      // Invoice numbers are not statement dates. Prefer the immutable
      // checkout snapshot: invoice names/balances can change while ACH clears.
      if (selection?.length) {
        const snapshots = (attempt.metadata as Record<string, unknown> | null)?.invoicePeriods;
        const byNumber = new Map(
          Array.isArray(snapshots) ? snapshots.map((s: any) => [s.invoiceNumber, s.statementYmd]) : [],
        );
        for (const [index, selected] of selection.entries()) {
          const ymd = byNumber.get(selected.invoiceNumber);
          if (typeof ymd !== "string" || !/^\d{4}-\d{2}-01$/.test(ymd))
            throw new SettlementRefusal("Selected invoice period is unavailable");
          allocations[index].statementYmd = ymd;
        }
      }
      const quote = (attempt.metadata as Record<string, unknown> | null)?.checkoutQuote as {
        unstatementedAmount?: string; creditAdjustment?: string; creditTransfers?: CheckoutCreditTransfer[];
      } | undefined;
      if (quote) {
        const unstatemented = Number(quote.unstatementedAmount);
        if (!Number.isFinite(unstatemented) || unstatemented < 0) throw new SettlementRefusal("Unstatemented allocation is invalid");
        if (selection?.length && unstatemented > 0) allocations.push({
          eaId: attempt.ledgerEaId, amount: unstatemented.toFixed(2), statementYmd: "",
        });
        const total = allocations.reduce((sum, row) => sum + Math.round(Number(row.amount) * 100), 0);
        if (total !== Math.round(Number(attempt.amount) * 100)) throw new SettlementRefusal("Checkout allocation total does not match payment");
        const creditTotal = (quote.creditTransfers ?? []).reduce((sum, transfer) => sum + checkoutMinor(transfer.amount), 0);
        if (creditTotal !== checkoutMinor(quote.creditAdjustment ?? "0.00")) throw new SettlementRefusal("Checkout credit attribution snapshot is incomplete");
        if (quote.creditTransfers?.length) {
          await storage.ledger.entries.applyCheckoutCreditTransfers(attempt.id, attempt.ledgerEaId, quote.creditTransfers);
        }
      }
      const now = new Date();
      const result = await createPaymentFromRequestBody({
        id: randomUUID(), status: "cleared", allocated: false, amount: attempt.amount,
        paymentType: paymentType.id, ledgerEaId: attempt.ledgerEaId,
        dateReceived: now.toISOString(), dateCleared: now.toISOString(),
        memo: "Online payment", details: {
          provider: gatewayId, paymentAttemptId: attempt.id,
          providerIntentRef: evidence.providerRef, proposedAllocation: allocations,
          statementSelection: selection ?? [],
          creditTransfers: quote?.creditTransfers ?? [],
        },
      }, { requireAccountId: attempt.accountId });
      if (!result.ok) throw new SettlementRefusal(result.message);
      if (!(await storage.ledger.paymentAttempts.claimLedgerPosting(attempt.id, result.payment.id))) {
        throw new Error("Payment link could not be claimed");
      }
      await triggerPaymentChargePlugins(result.payment);
    }
    const updated = await storage.ledger.paymentAttempts.updateStatus(attempt.id, status, {
      providerIntentRef: evidence.providerRef,
      lastProviderEventCreated: evidence.providerCreated ?? attempt.lastProviderEventCreated,
      failureCode: evidence.failureCode,
      failureMessage: status === "failed" ? "Payment failed" : status === "canceled" ? "Payment canceled" : null,
    });
    if (!updated) throw new Error("Payment state could not be saved");
    return "applied";
  });
}

/** A second, replayable effect: an unsuccessful save must not undo posted funds. */
export async function saveConfirmedMethod(attempt: LedgerPaymentAttempt, evidence: Evidence): Promise<void> {
  if (!attempt.saveMethod || attempt.status !== "succeeded" || !attempt.ledgerPaymentId) return;
  if ((attempt.metadata as Record<string, unknown> | null)?.methodSavedAt) return;
  const resolved = await resolveGateway(attempt.gatewayConfigId, { allowDisabled: true });
  if (!resolved.plugin.retrievePayment) throw new SettlementRefusal("Payment retrieval is unavailable");
  const confirmed = await resolved.plugin.retrievePayment(resolved.context, attempt.providerIntentRef!);
  if (confirmed.providerRef !== attempt.providerIntentRef || confirmed.status !== "succeeded" ||
      !paymentEventMatchesAmount(attempt, confirmed)) throw new SettlementRefusal("Saved method payment could not be confirmed");
  const ref = confirmed.methodRef ?? evidence.methodRef;
  if (!ref || (confirmed.methodRef && evidence.methodRef && confirmed.methodRef !== evidence.methodRef)) {
    throw new SettlementRefusal("Provider did not confirm the requested saved payment method");
  }
  await runInTransaction(async () => {
    const method = await storage.ledger.paymentMethods.upsertProviderMethod({
      entityType: attempt.entityType, entityId: attempt.entityId, gatewayConfigId: attempt.gatewayConfigId,
      providerMethodRef: ref, consent: attempt.consent,
      data: { summary: confirmed.methodSummary ?? evidence.methodSummary, createdByUserId: attempt.createdByUserId },
    });
    await storage.ledger.paymentAttempts.setDefaultIfAbsent(method.id, attempt.entityType, attempt.entityId, attempt.gatewayConfigId);
    await storage.ledger.paymentAttempts.markMethodSaved(attempt.id);
  });
}

export async function processPaymentEvidence(attemptId: string, gatewayId: string, evidence: Evidence): Promise<"applied" | "stale"> {
  const result = await settlePayment(attemptId, gatewayId, evidence);
  const attempt = await storage.ledger.paymentAttempts.get(attemptId);
  if (attempt?.status === "succeeded" && attempt.saveMethod) await saveConfirmedMethod(attempt, evidence);
  return result;
}

export async function logSettlementFailure(attemptId: string | null, reason: string): Promise<void> {
  storageLogger.error("Online payment reconciliation failed", {
    module: "ledger.paymentAttempts", operation: "reconcile", entity_id: attemptId ?? undefined,
    description: reason,
  });
}