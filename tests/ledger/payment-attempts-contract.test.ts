import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  selectFinancialPaymentType,
  shouldApplyPaymentEvent,
  paymentEventMatchesAmount,
} from "../../server/modules/ledger/payment-attempt-state";

describe("worker Stripe payment attempt backend", () => {
  it("keeps provider events and application idempotency keys unique", () => {
    const schema = readFileSync("shared/schema.ts", "utf8");
    expect(schema).toContain("ledger_payment_attempts_idempotency_key_unique");
    expect(schema).toContain("ledger_payment_attempt_events_provider_event_unique");
  });

  it("verifies raw Stripe signatures before applying webhook state", () => {
    const source = readFileSync("server/modules/ledger/payment-attempts.ts", "utf8");
    expect(source).toContain("rawBody");
    expect(source).toContain("verifyWebhook");
    expect(source).toContain("recordEvent");
    expect(source).toContain("stale");
    expect(source).toContain("attempt.gatewayConfigId !== req.params.gatewayConfigId");
    expect(source).toContain("attempt.providerIntentRef !== providerRef");
  });

  it("expires abandoned reservations and still records funds settled after a balance change", () => {
    const route = readFileSync("server/modules/ledger/payment-attempts.ts", "utf8");
    const storage = readFileSync("server/storage/ledger/payment_attempts.ts", "utf8");
    expect(route).toContain("expireReservations");
    expect(route).toContain("payment.canceled");
    expect(route).not.toContain("Settled payment exceeds the current payable balance");
    expect(storage).toContain("reservationExpiresAt");
    expect(storage).toContain("Payment confirmation expired");
  });

  it("requires an enabled component and signed webhook before charging", () => {
    const source = readFileSync("server/modules/ledger/payment-attempts.ts", "utf8");
    expect(source).toContain("assertGatewayReadyForCharge");
    expect(source).toContain("Component not enabled");
    expect(source).toContain("signed webhook is not configured");
  });

  it("selects a financial ledger payment type in the attempt currency", () => {
    const types = [
      { id: "usd-adjustment", category: "adjustment", currencyCode: "USD" },
      { id: "usd-payment", category: "financial", currencyCode: "USD" },
      { id: "cad-payment", category: "financial", currencyCode: "CAD" },
    ];
    expect(selectFinancialPaymentType(types, "cad")?.id).toBe("cad-payment");
    expect(selectFinancialPaymentType(types, "EUR")).toBeUndefined();

    const source = readFileSync("server/modules/ledger/payment-attempts.ts", "utf8");
    expect(source).toContain("No financial ledger payment type is configured");
    expect(source).toContain("ledgerPaymentTypeId");
  });

  it("retains removed worker methods as inactive attempt history", () => {
    const source = readFileSync("server/modules/ledger/payment-methods.ts", "utf8");
    expect(source).toContain('entityType === "worker"');
    expect(source).toContain("isActive: false");
    expect(source).toContain("paymentMethods.delete(pmId)");
  });

  it("exposes worker entity payment methods through the existing policy", () => {
    const source = readFileSync("server/modules/ledger/payment-methods.ts", "utf8");
    expect(source).toContain('worker: {');
    expect(source).toContain('policy: "worker.ledger"');
  });

  it("fails the gateway picker component gate closed when no checker exists", () => {
    const source = readFileSync("server/modules/ledger/payment-methods.ts", "utf8");
    expect(source).toContain(
      "(!checker || !(await checker(plugin.requiredComponent)))",
    );
  });

  it("rejects stale and equal-rank failure events after success", () => {
    expect(shouldApplyPaymentEvent("processing", 20, "succeeded", 21)).toBe(true);
    expect(shouldApplyPaymentEvent("succeeded", 21, "failed", 21)).toBe(false);
    expect(shouldApplyPaymentEvent("succeeded", 21, "processing", 20)).toBe(false);
    expect(shouldApplyPaymentEvent("succeeded", 21, "canceled", 22)).toBe(false);
    expect(shouldApplyPaymentEvent("succeeded", 21, "expired", 22)).toBe(false);
    // Replayed success must resume a posting interrupted after event receipt.
    expect(shouldApplyPaymentEvent("succeeded", 21, "succeeded", 21)).toBe(true);
  });

  it("requires exact amount and currency before posting a provider success", () => {
    const attempt = { amount: "12.34", currency: "USD" };
    expect(paymentEventMatchesAmount(attempt, { amountMinor: 1234, currency: "usd" })).toBe(true);
    expect(paymentEventMatchesAmount(attempt, { amountMinor: 1235, currency: "USD" })).toBe(false);
    expect(paymentEventMatchesAmount(attempt, { amountMinor: 1234, currency: "CAD" })).toBe(false);
    expect(paymentEventMatchesAmount(attempt, { amountMinor: 1234 })).toBe(false);
    expect(paymentEventMatchesAmount(attempt, { currency: "USD" })).toBe(false);
    expect(paymentEventMatchesAmount(attempt, { amountMinor: 1234.1, currency: "USD" })).toBe(false);
  });
});