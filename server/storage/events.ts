import { db } from "../db";
import { 
  events, 
  eventOccurrences,
  type Event, 
  type InsertEvent,
  type EventOccurrence,
  type InsertEventOccurrence
} from "@shared/schema";
import { eq, and, gte, lte, desc } from "drizzle-orm";
import { type StorageLoggingConfig } from "./middleware/logging";

export interface EventStorage {
  getAll(): Promise<Event[]>;
  get(id: string): Promise<Event | undefined>;
  create(event: InsertEvent): Promise<Event>;
  update(id: string, event: Partial<InsertEvent>): Promise<Event | undefined>;
  delete(id: string): Promise<boolean>;
}

export const eventLoggingConfig: StorageLoggingConfig<EventStorage> = {
  module: 'events',
  methods: {
    create: {
      enabled: true,
      getEntityId: (args) => args[0]?.title || 'new event',
      after: async (args, result) => result
    },
    update: {
      enabled: true,
      getEntityId: (args) => args[0],
      before: async (args, storage) => await storage.get(args[0]),
      after: async (args, result) => result
    },
    delete: {
      enabled: true,
      getEntityId: (args) => args[0],
      before: async (args, storage) => await storage.get(args[0])
    }
  }
};

export interface EventOccurrenceStorage {
  getAll(eventId: string): Promise<EventOccurrence[]>;
  get(id: string): Promise<EventOccurrence | undefined>;
  getByDateRange(startDate: Date, endDate: Date): Promise<EventOccurrence[]>;
  create(occurrence: InsertEventOccurrence): Promise<EventOccurrence>;
  createMany(occurrences: InsertEventOccurrence[]): Promise<EventOccurrence[]>;
  update(id: string, occurrence: Partial<InsertEventOccurrence>): Promise<EventOccurrence | undefined>;
  delete(id: string): Promise<boolean>;
  deleteByEventId(eventId: string): Promise<number>;
}

export const eventOccurrenceLoggingConfig: StorageLoggingConfig<EventOccurrenceStorage> = {
  module: 'eventOccurrences',
  methods: {
    create: {
      enabled: true,
      getEntityId: (args) => args[0]?.eventId || 'new occurrence',
      getHostEntityId: (args) => args[0]?.eventId,
      after: async (args, result) => result
    },
    createMany: {
      enabled: true,
      getEntityId: (args) => `batch of ${args[0]?.length || 0} occurrences`,
      getHostEntityId: (args) => args[0]?.[0]?.eventId,
      after: async (args, result) => ({ count: result?.length || 0 })
    },
    update: {
      enabled: true,
      getEntityId: (args) => args[0],
      before: async (args, storage) => await storage.get(args[0]),
      after: async (args, result) => result
    },
    delete: {
      enabled: true,
      getEntityId: (args) => args[0],
      before: async (args, storage) => await storage.get(args[0])
    },
    deleteByEventId: {
      enabled: true,
      getEntityId: (args) => args[0],
      after: async (args, result) => ({ deletedCount: result })
    }
  }
};

export function createEventStorage(): EventStorage {
  return {
    async getAll(): Promise<Event[]> {
      return db.select().from(events).orderBy(desc(events.createdAt));
    },

    async get(id: string): Promise<Event | undefined> {
      const [event] = await db.select().from(events).where(eq(events.id, id));
      return event || undefined;
    },

    async create(insertEvent: InsertEvent): Promise<Event> {
      const [event] = await db.insert(events).values(insertEvent).returning();
      return event;
    },

    async update(id: string, eventUpdate: Partial<InsertEvent>): Promise<Event | undefined> {
      const [event] = await db
        .update(events)
        .set(eventUpdate)
        .where(eq(events.id, id))
        .returning();
      return event || undefined;
    },

    async delete(id: string): Promise<boolean> {
      const result = await db.delete(events).where(eq(events.id, id)).returning();
      return result.length > 0;
    }
  };
}

export function createEventOccurrenceStorage(): EventOccurrenceStorage {
  return {
    async getAll(eventId: string): Promise<EventOccurrence[]> {
      return db.select().from(eventOccurrences)
        .where(eq(eventOccurrences.eventId, eventId))
        .orderBy(eventOccurrences.startAt);
    },

    async get(id: string): Promise<EventOccurrence | undefined> {
      const [occurrence] = await db.select().from(eventOccurrences).where(eq(eventOccurrences.id, id));
      return occurrence || undefined;
    },

    async getByDateRange(startDate: Date, endDate: Date): Promise<EventOccurrence[]> {
      return db.select().from(eventOccurrences)
        .where(and(
          gte(eventOccurrences.startAt, startDate),
          lte(eventOccurrences.startAt, endDate)
        ))
        .orderBy(eventOccurrences.startAt);
    },

    async create(insertOccurrence: InsertEventOccurrence): Promise<EventOccurrence> {
      const [occurrence] = await db.insert(eventOccurrences).values(insertOccurrence).returning();
      return occurrence;
    },

    async createMany(insertOccurrences: InsertEventOccurrence[]): Promise<EventOccurrence[]> {
      if (insertOccurrences.length === 0) return [];
      return db.insert(eventOccurrences).values(insertOccurrences).returning();
    },

    async update(id: string, occurrenceUpdate: Partial<InsertEventOccurrence>): Promise<EventOccurrence | undefined> {
      const [occurrence] = await db
        .update(eventOccurrences)
        .set(occurrenceUpdate)
        .where(eq(eventOccurrences.id, id))
        .returning();
      return occurrence || undefined;
    },

    async delete(id: string): Promise<boolean> {
      const result = await db.delete(eventOccurrences).where(eq(eventOccurrences.id, id)).returning();
      return result.length > 0;
    },

    async deleteByEventId(eventId: string): Promise<number> {
      const result = await db.delete(eventOccurrences).where(eq(eventOccurrences.eventId, eventId)).returning();
      return result.length;
    }
  };
}
