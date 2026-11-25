/** Safe assembled cardcheck shape shared by worker tokens, previews and events.
 * Deliberately not the database row: no signature, document or extension data. */
export const CARDCHECK_TOKEN_FIELDS = ["id", "type", "status", "signed_date", "worker_id"];

export function cardcheckTokenRow(cardcheck: {
  id?: string;
  workerId: string;
  type: string | null;
  status: string | null;
  signedDate: Date | string | null;
}) {
  return {
    id: cardcheck.id,
    workerId: cardcheck.workerId,
    type: cardcheck.type,
    status: cardcheck.status
      ? cardcheck.status.charAt(0).toUpperCase() + cardcheck.status.slice(1).toLowerCase()
      : null,
    // Events are JSON-safe, whereas live storage reads return Date objects.
    // Restore the same value type so field(format=...) behaves identically.
    signedDate: typeof cardcheck.signedDate === "string"
      ? new Date(cardcheck.signedDate)
      : cardcheck.signedDate,
  };
}

export type CardcheckStatus = "pending" | "signed" | "revoked";

export interface CardcheckStatusChangePayload {
  readonly cardcheckId: string;
  readonly workerId: string;
  readonly cardcheckDefinitionId: string;
  readonly previousStatus: CardcheckStatus;
  readonly newStatus: CardcheckStatus;
  readonly cardcheck: Readonly<{
    id: string;
    workerId: string;
    type: string;
    status: CardcheckStatus;
    signedDate: string | null;
  }>;
}
