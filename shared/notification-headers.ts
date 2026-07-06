/**
 * HTTP header a client sends to ask the server to suppress the notifications
 * that would otherwise be triggered by the events fired while handling that
 * request. Used by bulk-update flows so a mass change doesn't flood recipients.
 * Value must be the string "true".
 */
export const SUPPRESS_NOTIFICATIONS_HEADER = "x-suppress-notifications";
