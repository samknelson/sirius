import { storage } from "../../storage";
import { resolveGateway } from "./payment-gateway-context";
import { ensureCustomer } from "./payment-methods";
import { evidenceFromPayment, logSettlementFailure, processPaymentEvidence, settlementError, SettlementRefusal } from "./payment-settlement";
import { runInTransaction } from "../../storage/transaction-context";
import { initiatePayment } from "./payment-initiation";
import { assertAdminPaymentGateway, assertAdminAssistedPaymentProvenance } from "./admin-assisted-payment";

const BATCH_SIZE = 40;
const TEN_MINUTES = 10 * 60 * 1000;
const ONE_DAY = 24 * 60 * 60 * 1000;

/** Bounded reconciliation uses provider idempotency to recover lost create responses. */
export async function recoverOnlinePayments(): Promise<{ attempts: number; events: number; failures: number }> {
  let failures = 0;
  const events = await storage.ledger.paymentAttempts.listPendingEvents(BATCH_SIZE);
  for (const event of events) {
    try {
      const payload = event.payload as Record<string, unknown> | null;
      const ref = typeof payload?.providerRef === "string" ? payload.providerRef : undefined;
      const attempt = event.attemptId ? await storage.ledger.paymentAttempts.get(event.attemptId) :
        ref ? await storage.ledger.paymentAttempts.getByProviderIntent(ref, event.gatewayConfigId) : undefined;
      if (!attempt || !ref) {
        // The create response may still be outstanding. After a day the
        // attempt scan can recover it independently; retain the unknown
        // event as an auditable ignored receipt instead of starving the queue.
        if (Date.now() - new Date(event.receivedAt).getTime() > ONE_DAY) {
          await storage.ledger.paymentAttempts.markEventIgnored(event.gatewayConfigId, event.providerEventId, "Unknown payment attempt");
        }
        continue;
      }
      if (attempt.gatewayConfigId !== event.gatewayConfigId ||
          (attempt.providerIntentRef && attempt.providerIntentRef !== ref)) {
        await storage.ledger.paymentAttempts.markEventIgnored(event.gatewayConfigId, event.providerEventId, "Payment reference mismatch");
        continue;
      }
      const resolved = await resolveGateway(attempt.gatewayConfigId, { allowDisabled: true });
      if (!resolved.plugin.retrievePayment) throw new SettlementRefusal("Payment retrieval is unavailable");
      const payment = await resolved.plugin.retrievePayment(resolved.context, ref);
      if ((payload?.type === "payment.succeeded" && payment.status !== "succeeded") ||
          (payload?.type === "payment.failed" && !["failed", "succeeded"].includes(payment.status))) {
        throw new SettlementRefusal("Provider has not confirmed the received event yet");
      }
      await processPaymentEvidence(attempt.id, attempt.gatewayConfigId, {
        ...evidenceFromPayment(payment),
        methodRef: payment.methodRef ?? (typeof payload?.methodRef === "string" ? payload.methodRef : undefined),
      });
      await storage.ledger.paymentAttempts.markEventProcessed(event.gatewayConfigId, event.providerEventId);
    } catch (error) {
      failures++;
      const reason = settlementError(error);
      await storage.ledger.paymentAttempts.markEventError(event.gatewayConfigId, event.providerEventId, reason);
      await logSettlementFailure(event.attemptId, reason);
    }
  }
  const attempts = await storage.ledger.paymentAttempts.listForRecovery(
    BATCH_SIZE, new Date(Date.now() - TEN_MINUTES),
  );
  for (const attempt of attempts) {
    try {
      const resolved = await resolveGateway(attempt.gatewayConfigId, { allowDisabled: true });
      const metadata = attempt.metadata as Record<string, any> | null;
      const adminAssisted = assertAdminAssistedPaymentProvenance(attempt);
      if (adminAssisted) assertAdminPaymentGateway(attempt, resolved);
      const isAdminTestSource = metadata?.source === "admin_test_checkout";
      const hasAdminTestMarker = metadata?.adminTest?.isAdminTest === true;
      if (isAdminTestSource !== hasAdminTestMarker ||
          (hasAdminTestMarker && resolved.plugin.isTestMode?.(resolved.context) !== true)) {
        throw new SettlementRefusal("Admin test gateway no longer confirms test mode");
      }
      if (!resolved.plugin.retrievePayment) throw new SettlementRefusal("Payment retrieval is unavailable");
      let ref = attempt.providerIntentRef;
      if (!ref) {
        if (!resolved.plugin.createPaymentSession) throw new SettlementRefusal("Payment session recovery is unavailable");
        // Older worker intents used another provider creation contract and
        // idempotency key. Reissuing them as checkout sessions could charge
        // twice; leave them reserved for explicit provider investigation.
        if (metadata?.source !== "online_checkout" && metadata?.source !== "admin_test_checkout" && !adminAssisted)
          throw new SettlementRefusal("Legacy payment has no recoverable provider reference");
        const methodRef = typeof metadata?.paymentMethodRef === "string" ? metadata.paymentMethodRef : undefined;
        const customerRef = methodRef
          ? (await storage.ledger.gatewayCustomers.get(attempt.entityType, attempt.entityId, attempt.gatewayConfigId))?.customerRef
          : attempt.saveMethod ? await ensureCustomer(attempt.entityType, attempt.entityId, resolved.description, { allowDisabled: true }) : undefined;
        if (methodRef && !customerRef) throw new SettlementRefusal("Payment customer is unavailable");
        const session = await initiatePayment(attempt, resolved, {
          sessionId: attempt.id, amountMinor: Math.round(Number(attempt.amount) * 100),
          currency: attempt.currency, customerRef, savedMethodRef: methodRef,
          saveMethod: attempt.saveMethod,
          paymentTypes: Array.isArray(metadata?.paymentTypes) ? metadata.paymentTypes.filter((v): v is string => typeof v === "string") : ["card"],
          description: metadata?.source === "admin_test_checkout" ? "Admin test payment" : adminAssisted ? "Administrator payment on behalf of worker" : "Ledger payment",
          metadata: {
            attemptId: attempt.id, entityType: attempt.entityType, entityId: attempt.entityId,
            ...(metadata?.source === "admin_test_checkout" ? { paymentPurpose: "admin_test" } : {}),
            ...(adminAssisted ? { paymentPurpose: "admin_assisted" } : {}),
          },
        });
        ref = session.providerRef;
        // Never overwrite a reference supplied concurrently by a webhook.
        await runInTransaction(async () => {
          await storage.ledger.paymentAttempts.lockAttempt(attempt.id);
          const current = await storage.ledger.paymentAttempts.get(attempt.id);
          if (current?.providerIntentRef && current.providerIntentRef !== session.providerRef) throw new SettlementRefusal("Payment reference mismatch");
          if (current && !current.providerIntentRef) await storage.ledger.paymentAttempts.updateStatus(attempt.id, current.status, { providerIntentRef: ref });
        });
      }
      const payment = await resolved.plugin.retrievePayment(resolved.context, ref!);
      if (payment.providerRef !== ref) throw new SettlementRefusal("Payment reference mismatch");
      // Expiry needs a provider-confirmed cancellation. A processing ACH is
      // never time-expired; a non-cancelable payment stays reserved.
      if (Date.now() - new Date(attempt.createdAt ?? 0).getTime() > ONE_DAY &&
          ["created", "requires_action"].includes(payment.status) && resolved.plugin.cancelPayment) {
        try {
          const canceled = adminAssisted
            ? await resolved.plugin.cancelPayment(resolved.context, ref!, { adminAssistedAttemptId: attempt.id })
            : await resolved.plugin.cancelPayment(resolved.context, ref!);
          await processPaymentEvidence(attempt.id, attempt.gatewayConfigId, evidenceFromPayment(canceled));
          if (canceled.status === "canceled") {
            await runInTransaction(async () => {
              await storage.ledger.paymentAttempts.lockAttempt(attempt.id);
              const current = await storage.ledger.paymentAttempts.get(attempt.id);
              if (current?.status === "canceled" && !current.ledgerPaymentId)
                await storage.ledger.paymentAttempts.updateStatus(attempt.id, "expired", { failureMessage: "Payment confirmation expired" });
            });
          }
          continue;
        } catch {
          // The provider may have completed between retrieval and cancel.
          // Re-read; do not release the reservation on a refusal or outage.
        }
      }
      await processPaymentEvidence(attempt.id, attempt.gatewayConfigId, evidenceFromPayment(await resolved.plugin.retrievePayment(resolved.context, ref!)));
    } catch (error) {
      failures++;
      await logSettlementFailure(attempt.id, settlementError(error));
      // Keep the oldest failing row from monopolizing every bounded batch.
      await storage.ledger.paymentAttempts.touchRecovery(attempt.id);
    }
  }
  return { attempts: attempts.length, events: events.length, failures };
}