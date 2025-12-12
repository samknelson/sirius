import { db } from "../db";
import { flood, type Flood } from "@shared/schema";
import { eq, and, gt, sql, desc, inArray } from "drizzle-orm";

export interface FloodStorage {
  recordFloodEvent(event: string, identifier: string, expiresAt: Date): Promise<void>;
  countEventsInWindow(event: string, identifier: string, windowStart: Date): Promise<number>;
  cleanupExpired(): Promise<number>;
  listFloodEvents(eventType?: string): Promise<Flood[]>;
  getDistinctEventTypes(): Promise<string[]>;
  deleteFloodEvent(id: string): Promise<void>;
  deleteFloodEventsByType(eventType: string): Promise<number>;
  deleteAllFloodEvents(): Promise<number>;
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

    async listFloodEvents(eventType?: string): Promise<Flood[]> {
      const query = db.select().from(flood).orderBy(desc(flood.createdAt));
      
      if (eventType) {
        return query.where(eq(flood.event, eventType));
      }
      
      return query;
    },

    async getDistinctEventTypes(): Promise<string[]> {
      const result = await db
        .selectDistinct({ event: flood.event })
        .from(flood)
        .orderBy(flood.event);
      
      return result.map(r => r.event);
    },

    async deleteFloodEvent(id: string): Promise<void> {
      await db.delete(flood).where(eq(flood.id, id));
    },

    async deleteFloodEventsByType(eventType: string): Promise<number> {
      const result = await db
        .delete(flood)
        .where(eq(flood.event, eventType))
        .returning();
      
      return result.length;
    },

    async deleteAllFloodEvents(): Promise<number> {
      const result = await db.delete(flood).returning();
      return result.length;
    },
  };
}
