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
 * A reservation with a complete immutable quote reserves its cash and credit
 * allocation, not future increases to that period. Legacy or incomplete
 * evidence blocks its period rather than guessing what the attempt covers.
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
  const knownPeriods = new Map<string, { cash: number; credit: number; latestDue: number }>();
  let unknownReservation = false;
  let reservedUnstatemented = 0;
  for (const reservation of input.reservations) {
    const rows = reservation.statementSelection;
    const metadata = reservation.metadata as {
      checkoutQuote?: { unstatementedAmount?: string; creditTransfers?: CheckoutCreditTransfer[];
        statements?: Array<{ invoiceNumber: string; statementYmd: string; due: string; payable: string; creditAdjustment: string; selected: boolean }> };
      invoicePeriods?: Array<{ invoiceNumber: string; statementYmd: string }>;
    } | null;
    const periods = metadata?.invoicePeriods;
    const quote = metadata?.checkoutQuote;
    const validPeriod = (ymd: unknown): ymd is string => typeof ymd === "string" && /^\d{4}-(0[1-9]|1[0-2])-01$/.test(ymd);
    const validMoney = (value: unknown): value is string => typeof value === "string" && /^\d+(?:\.\d{1,2})?$/.test(value);
    const periodByNumber = new Map<string, string>();
    if (Array.isArray(periods)) for (const period of periods) {
      if (typeof period?.invoiceNumber === "string" && validPeriod(period.statementYmd)) {
        periodByNumber.set(period.invoiceNumber, period.statementYmd);
      }
    }
    if (Array.isArray(rows)) for (const row of rows) {
      if (typeof row?.invoiceNumber === "string") blocked.add(row.invoiceNumber);
    }
    const transfers = Array.isArray(quote?.creditTransfers) ? quote.creditTransfers : [];
    const transferByPeriod = new Map<string, number>();
    let validTransfers = true;
    for (const transfer of transfers) {
      if (!validPeriod(transfer?.targetStatementYmd) || !validPeriod(transfer?.sourceStatementYmd) ||
          !validMoney(transfer?.amount) || checkoutMinor(transfer.amount) <= 0) { validTransfers = false; continue; }
      transferByPeriod.set(transfer.targetStatementYmd, (transferByPeriod.get(transfer.targetStatementYmd) ?? 0) + checkoutMinor(transfer.amount));
      const source = sources.find(row => row.statementYmd === transfer.sourceStatementYmd);
      if (source) source.remaining = Math.max(0, source.remaining - checkoutMinor(transfer.amount));
    }
    const unstatemented = quote?.unstatementedAmount;
    const amount = checkoutMinor(reservation.amount);
    const cashByPeriod = new Map<string, number>();
    let valid = Array.isArray(rows) && Array.isArray(periods) && Array.isArray(quote?.statements) &&
      validMoney(unstatemented) && validTransfers && periodByNumber.size === periods.length;
    if (valid) for (const row of rows as Array<{ invoiceNumber?: unknown; amount?: unknown }>) {
      const period = periodByNumber.get(row.invoiceNumber as string);
      if (!period || !validMoney(row.amount)) { valid = false; break; }
      cashByPeriod.set(period, (cashByPeriod.get(period) ?? 0) + checkoutMinor(row.amount));
    }
    if (valid) {
      const selected = quote!.statements!.filter(row => row.selected);
      const selectedPeriods = new Set(selected.map(row => row.statementYmd));
      valid = selectedPeriods.size === selected.length && selectedPeriods.size === periodByNumber.size &&
        [...periodByNumber.values()].every(period => selectedPeriods.has(period)) &&
        [...transferByPeriod.keys()].every(period => selectedPeriods.has(period)) &&
        [...cashByPeriod.values()].reduce((sum, cash) => sum + cash, checkoutMinor(unstatemented!)) === amount;
      for (const row of selected) {
        if (!validPeriod(row.statementYmd) || periodByNumber.get(row.invoiceNumber) !== row.statementYmd ||
            !validMoney(row.due) || !validMoney(row.payable) || !validMoney(row.creditAdjustment) ||
            checkoutMinor(row.payable) !== (cashByPeriod.get(row.statementYmd) ?? 0) ||
            checkoutMinor(row.creditAdjustment) !== (transferByPeriod.get(row.statementYmd) ?? 0) ||
            checkoutMinor(row.due) !== checkoutMinor(row.payable) + checkoutMinor(row.creditAdjustment)) valid = false;
      }
    }
    if (valid) {
      reservedUnstatemented += checkoutMinor(unstatemented!);
      for (const row of quote!.statements!.filter(row => row.selected)) {
        const previous = knownPeriods.get(row.statementYmd) ?? { cash: 0, credit: 0, latestDue: 0 };
        knownPeriods.set(row.statementYmd, {
          cash: previous.cash + (cashByPeriod.get(row.statementYmd) ?? 0),
          credit: previous.credit + (transferByPeriod.get(row.statementYmd) ?? 0),
          latestDue: Math.max(previous.latestDue, checkoutMinor(row.due)),
        });
      }
    } else {
      for (const period of periodByNumber.values()) blockedPeriods.add(period);
      for (const period of transferByPeriod.keys()) blockedPeriods.add(period);
      if (!Array.isArray(rows) || rows.length === 0 || !Array.isArray(periods) ||
          periodByNumber.size !== periods.length || !validMoney(unstatemented) || !validTransfers) unknownReservation = true;
    }
  }
  if (reserved > 0 && input.reservations.length === 0) unknownReservation = true;
  if (input.reservations.reduce((sum, row) => sum + checkoutMinor(row.amount), 0) !== reserved) unknownReservation = true;
  const requested = new Set(selection.invoiceNumbers);
  const issues: string[] = [];
  if (unattributedCredit) issues.push("An account credit has no statement source. Contact the ledger administrator to attribute it before paying.");
  if (selection.mode === "statements" && !input.allowPartial) issues.push("This account requires payment of its full available balance.");
  if (requested.size !== selection.invoiceNumbers.length) issues.push("A statement was selected more than once.");
  if (selection.mode === "statements" && [...requested].some(number => !seen.has(number))) issues.push("A selected statement is no longer available. Refresh and choose again.");
  const statements = invoices.map(invoice => {
    const due = Math.max(0, checkoutMinor(invoice.invoiceBalance));
    const statementYmd = `${invoice.year}-${String(invoice.month).padStart(2, "0")}-01`;
    const evidence = knownPeriods.get(statementYmd);
    const isReserved = blockedPeriods.has(statementYmd) || unknownReservation ||
      (blocked.has(invoice.invoiceNumber) && !evidence) ||
      !!(evidence && (due < evidence.latestDue || due < evidence.cash + evidence.credit));
    const remainingDue = evidence ? Math.max(0, due - evidence.cash - evidence.credit) : due;
    let credit = 0;
    const transfers: CheckoutCreditTransfer[] = [];
    if (!isReserved) for (const source of sources) {
      const applied = Math.min(remainingDue - credit, source.remaining);
      if (applied <= 0) continue;
      credit += applied;
      source.remaining -= applied;
      transfers.push({ sourceInvoiceNumber: source.invoiceNumber, sourceStatementYmd: source.statementYmd,
        targetInvoiceNumber: invoice.invoiceNumber, targetStatementYmd: statementYmd, amount: money(applied) });
    }
    const payable = isReserved || unattributedCredit ? 0 : remainingDue - credit;
    const selected = selection.mode === "full" ? remainingDue > 0 && !isReserved : requested.has(invoice.invoiceNumber);
    if (selected && (isReserved || remainingDue <= 0) && selection.mode === "statements") issues.push(isReserved
      ? `Statement ${invoice.invoiceNumber} has a pending payment without enough allocation evidence for another payment. Wait for it to finish.`
      : `Statement ${invoice.invoiceNumber} has no payable balance.`);
    return { invoiceNumber: invoice.invoiceNumber, statementYmd,
      due: money(remainingDue), payable: money(payable), creditAdjustment: money(credit), reserved: isReserved || remainingDue <= 0, selected, transfers };
  });
  const selected = statements.filter(row => row.selected && checkoutMinor(row.payable) > 0);
  const unstatemented = selection.mode === "full" && !unknownReservation ? Math.max(0, unstatementedDebt - reservedUnstatemented) : 0;
  const total = selected.reduce((sum, row) => sum + checkoutMinor(row.payable), unstatemented);
  const creditTransfers = statements.filter(row => row.selected).flatMap(row => row.transfers);
  if (unknownReservation) issues.push("A pending payment has no statement allocation. Wait for it to finish before paying again.");
  if (total > available) issues.push("Balances changed while payments are pending. Refresh after pending payments finish.");
  if (selection.mode === "full" && total !== available) issues.push(reserved > 0
    ? "The full balance cannot be safely allocated while statement payments are pending. A pending payment may have missing or ambiguous statement allocation evidence; wait for it to finish."
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