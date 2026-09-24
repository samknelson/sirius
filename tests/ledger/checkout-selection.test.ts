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
  const cobra = (invoiceBalance: string, extra: CheckoutSelectionInput["invoices"] = []) => input({
    balance: "1302.05", reserved: "802.05",
    invoices: [{ invoiceNumber: "COBRA", invoiceBalance, year: 2026, month: 9 }, ...extra],
    reservations: [{
      amount: "802.05", statementSelection: [{ invoiceNumber: "COBRA", amount: "802.05" }],
      metadata: { invoicePeriods: [{ invoiceNumber: "COBRA", statementYmd: "2026-09-01" }],
        checkoutQuote: calculateCheckoutSelection(input({ balance: "802.05",
          invoices: [{ invoiceNumber: "COBRA", invoiceBalance: "802.05", year: 2026, month: 9 }] }),
        { mode: "full", invoiceNumbers: [] }) },
    }],
  });
  it("quotes only the $500 increment in a reserved COBRA month, even across multiple pending attempts", () => {
    const data = cobra("1302.05");
    const first = calculateCheckoutSelection(data, full);
    expect(first).toMatchObject({ available: "500.00", amount: "500.00",
      statementSelection: [{ invoiceNumber: "COBRA", amount: "500.00" }], issues: [] });
    expect(calculateCheckoutSelection(data, { mode: "statements", invoiceNumbers: ["COBRA"] }))
      .toMatchObject({ amount: "500.00", issues: [] });
    const second = calculateCheckoutSelection({ ...data, reservations: [...data.reservations, {
      amount: "500.00", statementSelection: first.statementSelection,
      metadata: { invoicePeriods: first.invoicePeriods, checkoutQuote: first },
    }], reserved: "1302.05" }, full);
    expect(second.amount).toBe("0.00");
    expect(second.statementSelection).toEqual([]);
    expect(second.statements[0].reserved).toBe(true);
  });
  it("allows the distinct period or account debt and refuses unsupported same-period evidence", () => {
    const other = cobra("802.05", [{ invoiceNumber: "OCT", invoiceBalance: "500.00", year: 2026, month: 10 }]);
    expect(calculateCheckoutSelection(other, full)).toMatchObject({ amount: "500.00", issues: [],
      statementSelection: [{ invoiceNumber: "OCT", amount: "500.00" }] });
    expect(calculateCheckoutSelection(other, { mode: "statements", invoiceNumbers: ["OCT"] }).issues).toEqual([]);
    const account = cobra("802.05");
    expect(calculateCheckoutSelection(account, full)).toMatchObject({ amount: "500.00", unstatementedAmount: "500.00", issues: [] });
    expect(calculateCheckoutSelection({ ...other, allowPartial: false }, { mode: "statements", invoiceNumbers: ["OCT"] }).issues.join(" ")).toContain("full available");
    const legacy = { ...cobra("1302.05"), reservations: [{ amount: "802.05", statementSelection: [{ invoiceNumber: "COBRA", amount: "802.05" }],
      metadata: { invoicePeriods: [{ invoiceNumber: "COBRA", statementYmd: "2026-09-01" }],
        checkoutQuote: { unstatementedAmount: "0.00" } } }] };
    expect(calculateCheckoutSelection(legacy, full).issues.join(" ")).toContain("ambiguous statement allocation evidence");
    expect(calculateCheckoutSelection(legacy, { mode: "statements", invoiceNumbers: ["COBRA"] }).issues.join(" ")).toContain("pending payment");
    expect(calculateCheckoutSelection(cobra("802.05"), full).amount).toBe("500.00"); // account debt, not a second statement charge
    expect(calculateCheckoutSelection({ ...cobra("1302.05"), balance: "802.05" }, full).amount).toBe("0.00");
  });
  it("does not reuse credit already committed to a pending attempt, and releases failed or canceled reservations", () => {
    const invoices = [
      { invoiceNumber: "COBRA", invoiceBalance: "852.05", year: 2026, month: 9 },
      { invoiceNumber: "CREDIT", invoiceBalance: "-50.00", year: 2026, month: 10 },
    ];
    const original = calculateCheckoutSelection(input({ balance: "802.05", invoices }), full);
    expect(original.creditAdjustment).toBe("50.00");
    const pending = input({ balance: "1302.05", reserved: "802.05",
      invoices: [{ ...invoices[0], invoiceBalance: "1352.05" }, invoices[1]],
      reservations: [{ amount: original.amount, statementSelection: original.statementSelection,
        metadata: { invoicePeriods: original.invoicePeriods, checkoutQuote: original } }] });
    const next = calculateCheckoutSelection(pending, full);
    expect(next).toMatchObject({ amount: "500.00", creditAdjustment: "0.00", creditTransfers: [], issues: [] });
    // Failed and canceled attempts leave getReservations; the full posted balance becomes payable.
    const released = calculateCheckoutSelection({ ...pending, reserved: "0.00", reservations: [] }, full);
    expect(released).toMatchObject({ amount: "1302.05", creditAdjustment: "50.00", issues: [] });
  });
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
       metadata: { invoicePeriods: [{ invoiceNumber: "2163-COBRA-202609", statementYmd: "2026-09-01" }],
         checkoutQuote: { unstatementedAmount: "0.00" } },
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