import { sessionHistory, type InsertSessionHistory } from "@shared/schema";
import { and, asc, eq, lt, sql } from "drizzle-orm";
import { getClient } from "../transaction-context";

export interface SessionHistoryStorage {
  create(entry: InsertSessionHistory): Promise<void>;
  countBefore(cutoff: Date): Promise<number>;
  getExpiredIds(cutoff: Date, limit: number): Promise<string[]>;
  deleteExpired(id: string, cutoff: Date): Promise<boolean>;
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
    async countBefore(cutoff) {
      const [row] = await getClient()
        .select({ count: sql<number>`count(*)` })
        .from(sessionHistory)
        .where(lt(sessionHistory.timestamp, cutoff));
      return Number(row.count);
    },
    async getExpiredIds(cutoff, limit) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
        throw new Error("Session history cleanup limit must be between 1 and 1000");
      }
      const rows = await getClient()
        .select({ id: sessionHistory.id })
        .from(sessionHistory)
        .where(lt(sessionHistory.timestamp, cutoff))
        .orderBy(asc(sessionHistory.timestamp), asc(sessionHistory.id))
        .limit(limit);
      return rows.map((row) => row.id);
    },
    async deleteExpired(id, cutoff) {
      const rows = await getClient()
        .delete(sessionHistory)
        .where(and(eq(sessionHistory.id, id), lt(sessionHistory.timestamp, cutoff)))
        .returning({ id: sessionHistory.id });
      return rows.length > 0;
    },
  };
}
