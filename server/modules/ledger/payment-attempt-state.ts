/** Provider timestamps are authoritative; equal-rank failure never undoes success. */
export function shouldApplyPaymentEvent(
  currentStatus: string,
  currentCreated: number | null | undefined,
  incomingStatus: string,
  incomingCreated: number | null | undefined,
): boolean {
  if (currentCreated && incomingCreated && incomingCreated < currentCreated) return false;
  if (currentStatus === "succeeded" && incomingStatus === "failed") return false;
  const rank = (s: string) => s === "requires_action" ? 0 : s === "processing" ? 1 : 2;
  return rank(incomingStatus) >= rank(currentStatus);
}

export type FinancialPaymentType = {
  id: string;
  category?: string | null;
  currencyCode?: string | null;
};

/** Pick only a financial payment type that can post to the attempt's currency. */
export function selectFinancialPaymentType<T extends FinancialPaymentType>(
  types: T[],
  currency: string,
): T | undefined {
  const normalizedCurrency = currency.trim().toUpperCase();
  return types.find(
    (type) =>
      type.category === "financial" &&
      type.currencyCode?.trim().toUpperCase() === normalizedCurrency,
  );
}