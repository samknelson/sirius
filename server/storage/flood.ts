import { db } from "../db";
import { flood } from "@shared/schema";
import { eq, and, gt, sql } from "drizzle-orm";

export interface FloodStorage {
  recordFloodEvent(event: string, identifier: string, expiresAt: Date): Promise<void>;
  countEventsInWindow(event: string, identifier: string, windowStart: Date): Promise<number>;
  cleanupExpired(): Promise<number>;
}

export function createFloodStorage(): FloodStorage {
  return {
    async recordFloodEvent(event: string, identifier: string, expiresAt: Date): Promise<void> {
      await db.insert(flood).values({
        event,
        identifier,
        expiresAt,
      });
    },

    async countEventsInWindow(event: string, identifier: string, windowStart: Date): Promise<number> {
      const result = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(flood)
        .where(
          and(
            eq(flood.event, event),
            eq(flood.identifier, identifier),
            gt(flood.createdAt, windowStart)
          )
        );
      
      return result[0]?.count ?? 0;
    },

    async cleanupExpired(): Promise<number> {
      const now = new Date();
      const result = await db
        .delete(flood)
        .where(sql`${flood.expiresAt} < ${now}`)
        .returning();
      
      return result.length;
    },
  };
}
