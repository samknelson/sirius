import { describe, expect, it } from "vitest";
import { classifyEntriesForPeriod } from "../../server/storage/ledger";

describe("invoice totals for payment-backed charges", () => {
  it("separates charge-directed financial and adjustment entries from receipts", () => {
    const entries = [
      { id: "charge", amount: "50.00", referenceType: "payment", referenceId: "charge-payment" },
      { id: "credit", amount: "-10.00", referenceType: "payment", referenceId: "credit-payment" },
      { id: "adjustment-charge", amount: "5.00", referenceType: "payment", referenceId: "adjustment-payment" },
      { id: "adjustment-credit", amount: "-2.00", referenceType: "payment", referenceId: "adjustment-credit-payment" },
      { id: "other-charge", amount: "8.00", referenceType: null, referenceId: null },
      { id: "other-credit", amount: "-3.00", referenceType: null, referenceId: null },
    ].map(entry => ({
      ...entry, date: new Date("2026-01-10T12:00:00Z"), statementYmd: "2026-01-01",
    }));
    const categories = new Map([
      ["charge-payment", { category: "financial" }],
      ["credit-payment", { category: "financial" }],
      ["adjustment-payment", { category: "adjustment" }],
      ["adjustment-credit-payment", { category: "adjustment" }],
    ]);
    const totals = classifyEntriesForPeriod(
      new Set(entries.map(entry => entry.id)), entries, categories, 1, 2026,
    );
    expect(totals).toEqual({
      chargesCents: 5800n,
      adjustmentsCents: 0n,
      paymentsReceivedCents: -1000n,
      paymentsAppliedCents: -1000n,
    });
  });
});