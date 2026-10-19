// Persisted event names and bucket identities survive the plugin cutover.
export const QUICKSEARCH_FLOOD_EVENT = "quicksearch";
export const LOCAL_LOGIN_FLOOD_EVENT = "local-login";
export const LOCAL_PASSWORD_CHANGE_FLOOD_EVENT = "local-password-change";
export const EDLS_SCHEDULE_ANSWER_FLOOD_EVENT = "edls-schedule-answer";
export const T631_ARRIVAL_WORKER_FLOOD_EVENT = "t631-arrival-worker";
export const T631_ARRIVAL_IP_FLOOD_EVENT = "t631-arrival-ip";
export const NOTIFICATION_FLOOD_EVENTS = {
  email: "notification-email",
  inapp: "notification-inapp",
  sms: "notification-sms",
  postal: "notification-postal",
} as const;
