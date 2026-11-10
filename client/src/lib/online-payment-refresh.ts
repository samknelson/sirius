/** Poll only provider-backed pending rows; manually entered payments are unrelated. */
export function hasPendingOnlinePayment(rows: readonly {
  status: string;
  details?: unknown;
}[] | undefined): boolean {
  return rows?.some(row => row.status === "pending" &&
    !!(row.details as Record<string, unknown> | null)?.paymentAttemptId) ?? false;
}
