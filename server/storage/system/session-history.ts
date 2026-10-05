import { sessionHistory, type InsertSessionHistory } from "@shared/schema";
import { getClient } from "../transaction-context";

export interface SessionHistoryStorage {
  create(entry: InsertSessionHistory): Promise<void>;
}

/**
 * Internal lifecycle observations, not directly maintained records.
 * Deliberately no storage logging wrapper/configuration or entity metadata.
 */
export function createSessionHistoryStorage(): SessionHistoryStorage {
  return {
    async create(entry) {
      await getClient().insert(sessionHistory).values(entry);
    },
  };
}
