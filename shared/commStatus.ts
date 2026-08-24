export const COMM_STATUSES = [
  "queued",
  "sending",
  "sent",
  "delivered",
  "received",
  "read",
  "undelivered",
  "failed",
  "offline",
  "logged",
] as const;

export type CommStatus = (typeof COMM_STATUSES)[number];

export const COMM_STATUS_LABELS: Record<CommStatus, string> = {
  queued: "Queued",
  sending: "Sending",
  sent: "Sent",
  delivered: "Delivered",
  received: "Received",
  read: "Read",
  undelivered: "Undelivered",
  failed: "Failed",
  offline: "Offline",
  logged: "Logged",
};

/**
 * Coarse delivery outcome of a communication:
 *
 * - `pending` — nothing has gone wrong, but delivery is not confirmed
 *   (still on its way, or handed off out-of-band so it can never be
 *   confirmed).
 * - `success` — the message reached its recipient.
 * - `error` — delivery failed.
 *
 * This is the single source of truth for "is this comm okay?" so that every
 * surface colouring or grouping by status agrees.
 */
export type CommStatusBucket = "pending" | "success" | "error";

const COMM_STATUS_BUCKETS: Record<CommStatus, CommStatusBucket> = {
  queued: "pending",
  sending: "pending",
  // Delivered out-of-band; delivery state is unverifiable, so never "success".
  offline: "pending",
  // Recorded without a provider delivery receipt.
  logged: "pending",
  sent: "success",
  delivered: "success",
  received: "success",
  read: "success",
  undelivered: "error",
  failed: "error",
};

function isCommStatus(status: string): status is CommStatus {
  return Object.prototype.hasOwnProperty.call(COMM_STATUS_BUCKETS, status);
}

/**
 * Bucket any status string, including values outside the canonical list
 * (legacy rows, provider-specific states). Unknown values are treated as
 * `pending`: an unrecognised status is not evidence of delivery, and not
 * evidence of failure either.
 */
export function getCommStatusBucket(status: string | null | undefined): CommStatusBucket {
  if (!status) return "pending";
  return isCommStatus(status) ? COMM_STATUS_BUCKETS[status] : "pending";
}

/**
 * Human-readable label for any status string; unrecognised values are shown
 * verbatim rather than hidden behind a generic word.
 */
export function getCommStatusLabel(status: string | null | undefined): string {
  if (!status) return "Unknown";
  return isCommStatus(status) ? COMM_STATUS_LABELS[status] : status;
}
