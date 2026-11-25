import { createSessionHistoryStorage } from "./storage/system/session-history";

/** Observations must never be wrapped in storage audit or entity metadata. */
export function createStorage() {
  return { sessionHistory: createSessionHistoryStorage() };
}
