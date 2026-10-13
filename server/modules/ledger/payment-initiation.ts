import type { LedgerPaymentAttempt } from "@shared/schema";
import { PaymentInitiationRejected, type CreatePaymentSessionInput, type GatewayPaymentSession } from "../../plugins/ledger/payment-gateway/types";
import { storage } from "../../storage";
import { runInTransaction } from "../../storage/transaction-context";
import type { resolveGateway } from "./payment-gateway-context";

type Gateway = Awaited<ReturnType<typeof resolveGateway>>;

export function checkoutPaymentTypes(resolved: Gateway, accountTypes: string[]): string[] {
  const data = resolved.config.data as Record<string, unknown> | null;
  const enabled = resolved.plugin.getCheckoutPaymentTypes?.(resolved.context) ??
    (Array.isArray(data?.paymentTypes)
      ? data.paymentTypes.filter((v): v is string => typeof v === "string")
      : (resolved.plugin.supportedPaymentTypes ?? []).map(t => t.id));
  const supported = resolved.plugin.supportedPaymentTypes?.map(t => t.id);
  return accountTypes.filter(type => enabled.includes(type) && (!supported || supported.includes(type)));
}

/**
 * Serialize initial create, replay, and recovery against webhook/cancellation.
 * A rejection on replay is NOT proof about a previous lost create response.
 * The fresh flag is granted only to the request that inserted the attempt.
 * New rows explicitly mark non-entry, so recovery can own the first call too;
 * historical rows without that evidence must stay conservative.
 */
export async function initiatePayment(
  attempt: LedgerPaymentAttempt, resolved: Gateway, args: CreatePaymentSessionInput,
  fresh = false,
): Promise<GatewayPaymentSession> {
  // Commit the call fence BEFORE any provider operation. A process/commit
  // failure after remote creation must not erase evidence that we entered it.
  const firstInvocation = await runInTransaction(async () => {
    await storage.ledger.paymentAttempts.lockAttempt(attempt.id);
    const current = await storage.ledger.paymentAttempts.get(attempt.id);
    if (!current || current.providerIntentRef ||
        (current.failureCode && current.failureCode !== "creation_not_started") ||
        !["created", "requires_action"].includes(current.status)) return false;
    const first = current.failureCode === "creation_not_started" || fresh;
    const fenced = await storage.ledger.paymentAttempts.updateStatus(attempt.id, current.status, {
      failureCode: first ? "creation_started" : "creation_uncertain",
    });
    if (!fenced) throw new Error("Payment initiation could not be fenced");
    return first;
  });
  const result = await runInTransaction(async (): Promise<{ session?: GatewayPaymentSession; error?: unknown }> => {
    await storage.ledger.paymentAttempts.lockAttempt(attempt.id);
    const current = await storage.ledger.paymentAttempts.get(attempt.id);
    if (!current) return { error: new Error("Payment attempt not found") };
    if (["failed", "canceled", "expired"].includes(current.status)) {
      return { error: new PaymentInitiationRejected("attempt_ended", "This checkout attempt has ended; start a new checkout") };
    }
    if (current.providerIntentRef) {
      const payment = await resolved.plugin.retrievePayment!(resolved.context, current.providerIntentRef);
      return { session: { providerRef: payment.providerRef, status: payment.status,
        clientSecret: payment.clientSecret ?? "", publicConfig: {
          publishableKey: (resolved.config.data as Record<string, unknown> | null)?.publishableKey,
          paymentTypes: args.paymentTypes,
        } } };
    }
    try {
      const session = await resolved.plugin.createPaymentSession!(resolved.context, args);
      const saved = await storage.ledger.paymentAttempts.updateStatus(attempt.id, session.status, {
        providerIntentRef: session.providerRef, failureCode: null,
      });
      if (!saved) throw new Error("Provider payment reference could not be saved");
      return { session };
    } catch (cause) {
      if (cause instanceof PaymentInitiationRejected && firstInvocation &&
          current.failureCode === "creation_started" &&
          ["created", "requires_action"].includes(current.status) && !current.ledgerPaymentId) {
        await storage.ledger.paymentAttempts.lockEa(current.ledgerEaId);
        const updated = await storage.ledger.paymentAttempts.updateStatus(attempt.id, "failed", {
          failureCode: cause.code, failureMessage: cause.message, reservationExpiresAt: null,
        });
        if (!updated) throw new Error("Payment rejection could not be saved");
        const eventId = `initiation-rejected:${attempt.id}`;
        await storage.ledger.paymentAttempts.recordEvent({
          gatewayConfigId: current.gatewayConfigId, attemptId: current.id,
          providerEventId: eventId, eventType: "payment.initiation_rejected",
          payload: { failureCode: cause.code },
        });
        await storage.ledger.paymentAttempts.markEventProcessed(current.gatewayConfigId, eventId);
        return { error: cause };
      }
      // Commit uncertainty even though the HTTP request fails. Never expose
      // provider error bodies, and never permit later config rejection to
      // release a payment that may already exist.
      await storage.ledger.paymentAttempts.updateStatus(attempt.id, current.status, {
        failureCode: "creation_uncertain",
      });
      return { error: new Error("Payment initiation could not be confirmed. Your balance remains reserved; check your unfinished payment status before paying again.") };
    }
  });
  // Throw AFTER commit so definitive rejection and its audit survive.
  if (result.error) throw result.error;
  return result.session!;
}
