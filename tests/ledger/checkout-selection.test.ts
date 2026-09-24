import { describe, expect, it } from "vitest";
import { calculateCheckoutSelection, type CheckoutSelectionInput } from "../../shared/ledger/checkout-selection";

const input = (overrides: Partial<CheckoutSelectionInput> = {}): CheckoutSelectionInput => ({
  balance: "367.35", reserved: "0.00", reservations: [], allowPartial: true, minAmount: 1,
  invoices: [
    { invoiceNumber: "2163-COBRA-202609", invoiceBalance: "267.35", year: 2026, month: 9 },
    { invoiceNumber: "OTHER", invoiceBalance: "100.00", year: 2026, month: 10 },
  ], ...overrides,
});
const selected = { mode: "statements" as const, invoiceNumbers: ["2163-COBRA-202609"] };
const full = { mode: "full" as const, invoiceNumbers: [] };

describe("authoritative whole-statement calculator", () => {
  it("quotes the representative COBRA statement without touching unrelated debt", () => {
    const quote = calculateCheckoutSelection(input(), selected);
    expect(quote.amount).toBe("267.35");
    expect(quote.statementSelection).toEqual([{ invoiceNumber: "2163-COBRA-202609", amount: "267.35" }]);
    expect(quote.invoicePeriods).toEqual([{ invoiceNumber: "2163-COBRA-202609", statementYmd: "2026-09-01" }]);
    expect(quote.issues).toEqual([]);
    expect(calculateCheckoutSelection(input(), full).amount).toBe("367.35");
    expect(calculateCheckoutSelection(input(), { mode: "statements", invoiceNumbers: ["OTHER", ...selected.invoiceNumbers] }).amount).toBe("367.35");
  });
  it("nets credits deterministically and explicitly, independent of request and invoice order", () => {
    const data = input({ balance: "317.35", invoices: [...input().invoices,
      { invoiceNumber: "CREDIT", invoiceBalance: "-50.00", year: 2026, month: 11 }] });
    const quote = calculateCheckoutSelection(data, selected);
    expect(quote.amount).toBe("217.35");
    expect(quote.creditAdjustment).toBe("50.00");
    expect(quote.creditTransfers).toEqual([{ sourceInvoiceNumber: "CREDIT", sourceStatementYmd: "2026-11-01",
      targetInvoiceNumber: "2163-COBRA-202609", targetStatementYmd: "2026-09-01", amount: "50.00" }]);
    expect(calculateCheckoutSelection({ ...data, invoices: [...data.invoices].reverse() }, selected)).toEqual(quote);
    expect(calculateCheckoutSelection(data, full).amount).toBe("317.35");
  });
  it("handles partially paid statements, credit-only accounts and no-statement balances", () => {
    expect(calculateCheckoutSelection(input({ invoices: [{ invoiceNumber: "PART", invoiceBalance: "20.00", year: 2026, month: 9 }], balance: "20.00" }), full).amount).toBe("20.00");
    expect(calculateCheckoutSelection(input({ balance: "-10.00" }), full).amount).toBe("0.00");
    const quote = calculateCheckoutSelection(input({ invoices: [], balance: "20.00" }), full);
    expect(quote.amount).toBe("20.00");
    expect(quote.unstatementedAmount).toBe("20.00");
    expect(quote.issues).toEqual([]);
  });
  it("includes unstatemented debt only in full balance", () => {
    expect(calculateCheckoutSelection(input({ balance: "400.00" }), selected).amount).toBe("267.35");
    const quote = calculateCheckoutSelection(input({ balance: "400.00" }), full);
    expect(quote.amount).toBe("400.00");
    expect(quote.unstatementedAmount).toBe("32.65");
  });
  it("reserves immutable credit sources and zero-cash target periods until settlement", () => {
    const data = input({ balance: "217.35", invoices: [...input().invoices,
      { invoiceNumber: "CREDIT", invoiceBalance: "-150.00", year: 2026, month: 11 }] });
    const first = calculateCheckoutSelection(data, selected);
    const next = calculateCheckoutSelection({ ...data, reserved: first.amount, reservations: [{
      amount: first.amount, statementSelection: first.statementSelection,
      metadata: { invoicePeriods: first.invoicePeriods, checkoutQuote: first },
    }] }, full);
    expect(next.amount).toBe("100.00");
    expect(next.creditAdjustment).toBe("0.00");
    expect(next.creditTransfers).toEqual([]);
    expect(next.issues).toEqual([]);
  });
  it("blocks overlapping statements even with abundant unrelated debt", () => {
    const data = input({ balance: "1000.00", reserved: "267.35", reservations: [{
      amount: "267.35", statementSelection: [{ invoiceNumber: "2163-COBRA-202609", amount: "267.35" }],
      metadata: { checkoutQuote: { unstatementedAmount: "0.00" } },
    }] });
    expect(calculateCheckoutSelection(data, selected).issues.join(" ")).toContain("pending payment");
    const quote = calculateCheckoutSelection(data, full);
    expect(quote.amount).toBe("732.65");
    expect(quote.issues).toEqual([]);
    expect(quote.statementSelection).toEqual([{ invoiceNumber: "OTHER", amount: "100.00" }]);
  });
  it("blocks ambiguous legacy reservations and stale, empty, duplicate and below-minimum choices", () => {
    expect(calculateCheckoutSelection(input({ reserved: "20.00", reservations: [{ amount: "20.00", statementSelection: [] }] }), selected).issues.join(" ")).toContain("no statement allocation");
    expect(calculateCheckoutSelection(input(), { mode: "statements", invoiceNumbers: ["MISSING"] }).issues.join(" ")).toContain("no longer available");
    expect(calculateCheckoutSelection(input(), { mode: "statements", invoiceNumbers: [] }).issues.length).toBeGreaterThan(0);
    expect(calculateCheckoutSelection(input(), { mode: "statements", invoiceNumbers: ["OTHER", "OTHER"] }).issues.join(" ")).toContain("more than once");
    expect(calculateCheckoutSelection(input({ minAmount: 300 }), selected).issues.join(" ")).toContain("minimum");
    expect(calculateCheckoutSelection(input({ allowPartial: false }), selected).issues.join(" ")).toContain("full available balance");
    expect(calculateCheckoutSelection(input({ allowPartial: false }), full).issues).toEqual([]);
  });
});