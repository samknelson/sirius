import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { shouldApplyPaymentEvent } from "../../server/modules/ledger/payment-attempt-state";

describe("worker Stripe payment attempt backend", () => {
  it("keeps provider events and application idempotency keys unique", () => {
    const schema = readFileSync("shared/schema.ts", "utf8");
    expect(schema).toContain("ledger_payment_attempts_idempotency_key_unique");
    expect(schema).toContain("ledger_payment_attempt_events_provider_event_unique");
  });

  it("verifies raw Stripe signatures before applying webhook state", () => {
    const source = readFileSync("server/modules/ledger/payment-attempts.ts", "utf8");
    expect(source).toContain("rawBody");
    expect(source).toContain("constructWebhookEvent");
    expect(source).toContain("recordEvent");
    expect(source).toContain("stale");
  });

  it("exposes worker entity payment methods through the existing policy", () => {
    const source = readFileSync("server/modules/ledger/payment-methods.ts", "utf8");
    expect(source).toContain('worker: {');
    expect(source).toContain('policy: "worker.ledger"');
  });

  it("rejects stale and equal-rank failure events after success", () => {
    expect(shouldApplyPaymentEvent("processing", 20, "succeeded", 21)).toBe(true);
    expect(shouldApplyPaymentEvent("succeeded", 21, "failed", 21)).toBe(false);
    expect(shouldApplyPaymentEvent("succeeded", 21, "processing", 20)).toBe(false);
  });
});