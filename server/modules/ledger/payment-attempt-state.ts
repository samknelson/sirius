/** Provider timestamps are authoritative; equal-rank failure never undoes success. */
export function shouldApplyPaymentEvent(
  currentStatus: string,
  currentCreated: number | null | undefined,
  incomingStatus: string,
  incomingCreated: number | null | undefined,
): boolean {
  if (currentCreated && incomingCreated && incomingCreated < currentCreated) return false;
  if (currentStatus === "succeeded" && incomingStatus !== "succeeded") return false;
  const rank = (s: string) => s === "created" || s === "requires_action" ? 0 : s === "processing" ? 1 : 2;
  return rank(incomingStatus) >= rank(currentStatus);
}

/** Never post an unverified, missing or differently denominated amount. */
export function paymentEventMatchesAmount(
  attempt: { amount: string; currency: string },
  event: { amountMinor?: number; currency?: string },
): boolean {
  return Number.isSafeInteger(event.amountMinor) &&
    /^\d+(?:\.\d{1,2})?$/.test(attempt.amount) &&
    Math.round(Number(attempt.amount) * 100) === event.amountMinor &&
    typeof event.currency === "string" &&
    attempt.currency.toUpperCase() === event.currency.toUpperCase();
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