/** Shared, integer-minor-unit checkout quote. No payer-editable allocations. */
export type CheckoutSelection = { mode: "full" | "statements"; invoiceNumbers: string[] };
export type CheckoutCreditTransfer = {
  sourceInvoiceNumber: string;
  sourceStatementYmd: string;
  targetInvoiceNumber: string;
  targetStatementYmd: string;
  amount: string;
};
export type CheckoutInvoice = {
  invoiceNumber: string;
  invoiceBalance: string | number;
  year: number;
  month: number;
};
export type CheckoutReservation = {
  amount: string | number;
  statementSelection: unknown;
  metadata?: unknown;
};
export type CheckoutSelectionInput = {
  balance: string | number;
  reserved: string | number;
  invoices: CheckoutInvoice[];
  reservations: CheckoutReservation[];
  allowPartial: boolean;
  minAmount: number;
};
export type CheckoutQuote = {
  amount: string;
  amountMinor: number;
  available: string;
  postedBalance: string;
  pendingPayments: string;
  creditAdjustment: string;
  /** Zero-sum ledger transfers posted atomically with the payment. Show sources in review. */
  creditTransfers: CheckoutCreditTransfer[];
  unstatementedAmount: string;
  statements: Array<{
    invoiceNumber: string;
    statementYmd: string;
    due: string;
    payable: string;
    creditAdjustment: string;
    reserved: boolean;
    selected: boolean;
  }>;
  statementSelection: Array<{ invoiceNumber: string; amount: string }>;
  invoicePeriods: Array<{ invoiceNumber: string; statementYmd: string }>;
  issues: string[];
};

export function checkoutMinor(value: string | number): number {
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(String(value))) throw new Error("Invalid checkout balance");
  const result = Math.round(Number(value) * 100);
  if (!Number.isSafeInteger(result)) throw new Error("Checkout balance is outside the supported range");
  return result;
}
const money = (cents: number) => (cents / 100).toFixed(2);

/**
 * Credits are attributed from named negative statement periods to oldest
 * statement debt. Sources without a period cannot be safely transferred.
 * Reserved statements are unavailable until their attempt completes. Legacy
 * unallocated reservations block selection rather than guessing their target.
 */
export function calculateCheckoutSelection(input: CheckoutSelectionInput, selection: CheckoutSelection): CheckoutQuote {
  const balance = checkoutMinor(input.balance);
  const reserved = checkoutMinor(input.reserved);
  if (reserved < 0) throw new Error("Invalid pending payment balance");
  const available = Math.max(0, balance - reserved);
  const invoices = [...input.invoices].sort((a, b) =>
    a.year - b.year || a.month - b.month || (a.invoiceNumber < b.invoiceNumber ? -1 : a.invoiceNumber > b.invoiceNumber ? 1 : 0));
  const seen = new Set<string>();
  for (const invoice of invoices) {
    if (seen.has(invoice.invoiceNumber)) throw new Error("Duplicate statement number");
    seen.add(invoice.invoiceNumber);
    if (!Number.isInteger(invoice.year) || invoice.year < 1000 || invoice.year > 9999 ||
        !Number.isInteger(invoice.month) || invoice.month < 1 || invoice.month > 12) throw new Error("Statement period is unavailable");
  }
  const invoiceTotal = invoices.reduce((sum, invoice) => sum + checkoutMinor(invoice.invoiceBalance), 0);
  const unattributedCredit = balance < invoiceTotal;
  const unstatementedDebt = Math.max(0, balance - invoiceTotal);
  const sources = invoices.filter(invoice => checkoutMinor(invoice.invoiceBalance) < 0).map(invoice => ({
    invoiceNumber: invoice.invoiceNumber,
    statementYmd: `${invoice.year}-${String(invoice.month).padStart(2, "0")}-01`,
    remaining: -checkoutMinor(invoice.invoiceBalance),
  }));
  const blocked = new Set<string>();
  const blockedPeriods = new Set<string>();
  let unknownReservation = false;
  let reservedUnstatemented = 0;
  for (const reservation of input.reservations) {
    const rows = reservation.statementSelection;
    const metadata = reservation.metadata as {
      checkoutQuote?: { unstatementedAmount?: string; creditTransfers?: CheckoutCreditTransfer[] };
      invoicePeriods?: Array<{ statementYmd: string }>;
    } | null;
    for (const period of metadata?.invoicePeriods ?? []) blockedPeriods.add(period.statementYmd);
    for (const transfer of metadata?.checkoutQuote?.creditTransfers ?? []) {
      blockedPeriods.add(transfer.targetStatementYmd);
      const source = sources.find(row => row.statementYmd === transfer.sourceStatementYmd);
      if (source) source.remaining = Math.max(0, source.remaining - checkoutMinor(transfer.amount));
    }
    if (Array.isArray(rows)) for (const row of rows) {
      if (typeof row?.invoiceNumber === "string") blocked.add(row.invoiceNumber);
    }
    const unstatemented = metadata?.checkoutQuote?.unstatementedAmount;
    if (unstatemented !== undefined) reservedUnstatemented += checkoutMinor(unstatemented);
    else if (!Array.isArray(rows) || rows.length === 0) unknownReservation = true;
  }
  if (reserved > 0 && input.reservations.length === 0) unknownReservation = true;
  const requested = new Set(selection.invoiceNumbers);
  const issues: string[] = [];
  if (unattributedCredit) issues.push("An account credit has no statement source. Contact the ledger administrator to attribute it before paying.");
  if (selection.mode === "statements" && !input.allowPartial) issues.push("This account requires payment of its full available balance.");
  if (requested.size !== selection.invoiceNumbers.length) issues.push("A statement was selected more than once.");
  if (selection.mode === "statements" && [...requested].some(number => !seen.has(number))) issues.push("A selected statement is no longer available. Refresh and choose again.");
  const statements = invoices.map(invoice => {
    const due = Math.max(0, checkoutMinor(invoice.invoiceBalance));
    const statementYmd = `${invoice.year}-${String(invoice.month).padStart(2, "0")}-01`;
    const isReserved = blocked.has(invoice.invoiceNumber) || blockedPeriods.has(statementYmd) || unknownReservation;
    let credit = 0;
    const transfers: CheckoutCreditTransfer[] = [];
    if (!isReserved) for (const source of sources) {
      const applied = Math.min(due - credit, source.remaining);
      if (applied <= 0) continue;
      credit += applied;
      source.remaining -= applied;
      transfers.push({ sourceInvoiceNumber: source.invoiceNumber, sourceStatementYmd: source.statementYmd,
        targetInvoiceNumber: invoice.invoiceNumber, targetStatementYmd: statementYmd, amount: money(applied) });
    }
    const payable = isReserved || unattributedCredit ? 0 : due - credit;
    const selected = selection.mode === "full" ? due > 0 && !isReserved : requested.has(invoice.invoiceNumber);
    if (selected && (isReserved || due <= 0) && selection.mode === "statements") issues.push(isReserved
      ? `Statement ${invoice.invoiceNumber} has a pending payment. Wait for it to finish.`
      : `Statement ${invoice.invoiceNumber} has no payable balance.`);
    return { invoiceNumber: invoice.invoiceNumber, statementYmd,
      due: money(due), payable: money(payable), creditAdjustment: money(credit), reserved: isReserved, selected, transfers };
  });
  const selected = statements.filter(row => row.selected && checkoutMinor(row.payable) > 0);
  const unstatemented = selection.mode === "full" && !unknownReservation ? Math.max(0, unstatementedDebt - reservedUnstatemented) : 0;
  const total = selected.reduce((sum, row) => sum + checkoutMinor(row.payable), unstatemented);
  const creditTransfers = statements.filter(row => row.selected).flatMap(row => row.transfers);
  if (unknownReservation) issues.push("A pending payment has no statement allocation. Wait for it to finish before paying again.");
  if (total > available) issues.push("Balances changed while payments are pending. Refresh after pending payments finish.");
  if (selection.mode === "full" && total !== available) issues.push(reserved > 0
    ? "The full balance cannot be safely allocated while statement payments are pending."
    : "The full balance needs statement attribution for its account credits or unstatemented debt. Contact the ledger administrator before paying.");
  if (total <= 0) issues.push("Choose an outstanding statement or wait for pending payments to finish.");
  else if (total < checkoutMinor(input.minAmount)) issues.push(`The payment minimum is ${money(checkoutMinor(input.minAmount))}. Select additional statements or pay the full balance.`);
  return {
    amount: money(total), amountMinor: total, available: money(available), postedBalance: money(balance), pendingPayments: money(reserved),
    creditAdjustment: money(statements.filter(row => row.selected).reduce((sum, row) => sum + checkoutMinor(row.creditAdjustment), 0)),
    creditTransfers,
    unstatementedAmount: money(unstatemented), statements: statements.map(({ transfers: _transfers, ...row }) => row),
    statementSelection: selected.map(row => ({ invoiceNumber: row.invoiceNumber, amount: row.payable })),
    invoicePeriods: selected.map(row => ({ invoiceNumber: row.invoiceNumber, statementYmd: row.statementYmd })), issues,
  };
}