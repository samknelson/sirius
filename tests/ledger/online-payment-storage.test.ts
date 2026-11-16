import { describe, expect, it } from "vitest";
import { shouldApplyPaymentEvent, paymentEventMatchesAmount } from "../../server/modules/ledger/payment-attempt-state";

describe("payment lifecycle state boundary", () => {
  it("does not undo success with duplicate or out-of-order failures", () => {
    expect(shouldApplyPaymentEvent("succeeded", 20, "processing", 10)).toBe(false);
    expect(shouldApplyPaymentEvent("succeeded", 20, "failed", 30)).toBe(false);
    expect(shouldApplyPaymentEvent("succeeded", 20, "succeeded", 20)).toBe(true);
  });
  it("allows a confirmed late success but never manufactures money evidence", () => {
    expect(shouldApplyPaymentEvent("failed", 10, "succeeded", 20)).toBe(true);
    expect(paymentEventMatchesAmount({ amount: "10.00", currency: "USD" }, { amountMinor: 1000, currency: "usd" })).toBe(true);
    expect(paymentEventMatchesAmount({ amount: "10.00", currency: "USD" }, { amountMinor: 1000, currency: "EUR" })).toBe(false);
    expect(paymentEventMatchesAmount({ amount: "10.00", currency: "USD" }, {})).toBe(false);
  });
});
