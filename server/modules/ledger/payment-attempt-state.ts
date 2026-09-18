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