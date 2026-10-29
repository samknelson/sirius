import { createNoopValidator } from '../utils/validation';
import { getClient } from '../transaction-context';
import { flood, pluginConfigs, type Flood } from "@shared/schema";
import { eq, and, gt, sql, desc } from "drizzle-orm";

/**
 * Stub validator - add validation logic here when needed
 */
export const validate = createNoopValidator();

export interface FloodStorage {
  recordFloodEvent(pluginConfigurationId: string, event: string, identifier: string, expiresAt: Date): Promise<void>;
  countEventsInWindow(pluginConfigurationId: string, identifier: string, windowStart: Date): Promise<number>;
  listFloodEvents(eventType?: string): Promise<(Flood & { configurationName: string | null })[]>;
  getDistinctEventTypes(): Promise<string[]>;
  deleteFloodEvent(id: string): Promise<void>;
  deleteFloodEventsByType(eventType: string): Promise<number>;
  deleteAllFloodEvents(): Promise<number>;
}

export function createFloodStorage(): FloodStorage {
  return {
    async recordFloodEvent(pluginConfigurationId: string, event: string, identifier: string, expiresAt: Date): Promise<void> {
      const client = getClient();
      await client.insert(flood).values({
        pluginConfigurationId,
        event,
        identifier,
        expiresAt,
      });
    },

    async countEventsInWindow(pluginConfigurationId: string, identifier: string, windowStart: Date): Promise<number> {
      const client = getClient();
      const result = await client
        .select({ count: sql<number>`count(*)::int` })
        .from(flood)
        .where(
          and(
            eq(flood.pluginConfigurationId, pluginConfigurationId),
            eq(flood.identifier, identifier),
            gt(flood.createdAt, windowStart)
          )
        );
      
      return result[0]?.count ?? 0;
    },

    async listFloodEvents(eventType?: string) {
      const client = getClient();
      const query = client.select({
        id: flood.id, event: flood.event, identifier: flood.identifier,
        pluginConfigurationId: flood.pluginConfigurationId,
        createdAt: flood.createdAt, expiresAt: flood.expiresAt,
        configurationName: pluginConfigs.name,
      }).from(flood).innerJoin(pluginConfigs, eq(flood.pluginConfigurationId, pluginConfigs.id))
        .orderBy(desc(flood.createdAt));
      
      if (eventType) {
        return query.where(eq(flood.event, eventType));
      }
      
      return query;
    },

    async getDistinctEventTypes(): Promise<string[]> {
      const client = getClient();
      const result = await client
        .selectDistinct({ event: flood.event })
        .from(flood)
        .orderBy(flood.event);
      
      return result.map(r => r.event);
    },

    async deleteFloodEvent(id: string): Promise<void> {
      const client = getClient();
      await client.delete(flood).where(eq(flood.id, id));
    },

    async deleteFloodEventsByType(eventType: string): Promise<number> {
      const client = getClient();
      const result = await client
        .delete(flood)
        .where(eq(flood.event, eventType))
        .returning();
      
      return result.length;
    },

    async deleteAllFloodEvents(): Promise<number> {
      const client = getClient();
      const result = await client.delete(flood).returning();
      return result.length;
    },
  };
}
