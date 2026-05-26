export const COMM_STATUSES = [
  "queued",
  "sending",
  "sent",
  "delivered",
  "received",
  "read",
  "undelivered",
  "failed",
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
};
