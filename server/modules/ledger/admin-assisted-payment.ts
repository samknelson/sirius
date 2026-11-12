import { ADMIN_PAYMENT_CONFIRMATION } from "@shared/ledger/admin-payment-confirmation";
import type { ResolvedGateway } from "./payment-gateway-context";

/** Bind recovery to the credentials used at creation, never a later live/account switch. */
export function adminPaymentGatewayFingerprint(gateway: ResolvedGateway): string {
  return gateway.configuration.fingerprint;
}

export function assertAdminPaymentGateway(attempt: { metadata?: unknown }, gateway: ResolvedGateway): void {
  const metadata = attempt.metadata as Record<string, any> | null;
  if (metadata?.adminAssisted?.gatewayFingerprint !== adminPaymentGatewayFingerprint(gateway)) {
    throw new Error("The payment gateway credentials have changed. Restore the original configuration or contact support to reconcile this payment before retrying.");
  }
}

/** Fail closed on damaged provenance in settlement and automatic recovery. */
export function assertAdminAssistedPaymentProvenance(attempt: {
  entityType: string; createdByUserId?: string | null; consent?: unknown;
  saveMethod?: boolean; paymentMethodId?: string | null; metadata?: unknown;
}): boolean {
  const metadata = attempt.metadata as Record<string, any> | null;
  const source = metadata?.source === "admin_assisted_checkout";
  const details = metadata?.adminAssisted;
  if (!source && !details) return false;
  if (!source || !details || attempt.entityType !== "worker" ||
      !attempt.createdByUserId || details.actorUserId !== attempt.createdByUserId ||
      !/^[a-f0-9]{64}$/.test(details.gatewayFingerprint ?? "") ||
      details.confirmation?.version !== ADMIN_PAYMENT_CONFIRMATION.version ||
      details.confirmation?.text !== ADMIN_PAYMENT_CONFIRMATION.text ||
      details.confirmation?.accepted !== true ||
      typeof details.confirmation?.acceptedAt !== "string" ||
      !Number.isFinite(Date.parse(details.confirmation.acceptedAt)) ||
      attempt.consent != null || attempt.saveMethod || attempt.paymentMethodId ||
      metadata?.paymentMethodRef || metadata?.adminTest) {
    throw new Error("Administrator payment provenance is invalid");
  }
  return true;
}
