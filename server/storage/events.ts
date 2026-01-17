import { createNoopValidator } from './utils/validation';
import { getClient } from './transaction-context';
import { 
  events, 
  eventOccurrences,
  eventParticipants,
  contacts,
  type Event, 
  type InsertEvent,
  type EventOccurrence,
  type InsertEventOccurrence,
  type EventParticipant,
  type InsertEventParticipant
} from "@shared/schema";
import { eq, and, gte, lte, desc } from "drizzle-orm";
import { type StorageLoggingConfig } from "./middleware/logging";

/**
 * Stub validator - add validation logic here when needed
 */
export const validate = createNoopValidator<InsertEvent, Event>();

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
      const client = getClient();
      return client.select().from(events).orderBy(desc(events.createdAt));
    },

    async get(id: string): Promise<Event | undefined> {
      const client = getClient();
      const [event] = await client.select().from(events).where(eq(events.id, id));
      return event || undefined;
    },

    async create(insertEvent: InsertEvent): Promise<Event> {
      validate.validateOrThrow(insertEvent);
      const client = getClient();
      const [event] = await client.insert(events).values(insertEvent).returning();
      return event;
    },

    async update(id: string, eventUpdate: Partial<InsertEvent>): Promise<Event | undefined> {
      validate.validateOrThrow(eventUpdate);
      const client = getClient();
      const [event] = await client
        .update(events)
        .set(eventUpdate)
        .where(eq(events.id, id))
        .returning();
      return event || undefined;
    },

    async delete(id: string): Promise<boolean> {
      const client = getClient();
      const result = await client.delete(events).where(eq(events.id, id)).returning();
      return result.length > 0;
    }
  };
}

export function createEventOccurrenceStorage(): EventOccurrenceStorage {
  return {
    async getAll(eventId: string): Promise<EventOccurrence[]> {
      const client = getClient();
      return client.select().from(eventOccurrences)
        .where(eq(eventOccurrences.eventId, eventId))
        .orderBy(eventOccurrences.startAt);
    },

    async get(id: string): Promise<EventOccurrence | undefined> {
      const client = getClient();
      const [occurrence] = await client.select().from(eventOccurrences).where(eq(eventOccurrences.id, id));
      return occurrence || undefined;
    },

    async getByDateRange(startDate: Date, endDate: Date): Promise<EventOccurrence[]> {
      const client = getClient();
      return client.select().from(eventOccurrences)
        .where(and(
          gte(eventOccurrences.startAt, startDate),
          lte(eventOccurrences.startAt, endDate)
        ))
        .orderBy(eventOccurrences.startAt);
    },

    async create(insertOccurrence: InsertEventOccurrence): Promise<EventOccurrence> {
      const client = getClient();
      const [occurrence] = await client.insert(eventOccurrences).values(insertOccurrence).returning();
      return occurrence;
    },

    async createMany(insertOccurrences: InsertEventOccurrence[]): Promise<EventOccurrence[]> {
      const client = getClient();
      if (insertOccurrences.length === 0) return [];
      return client.insert(eventOccurrences).values(insertOccurrences).returning();
    },

    async update(id: string, occurrenceUpdate: Partial<InsertEventOccurrence>): Promise<EventOccurrence | undefined> {
      const client = getClient();
      const [occurrence] = await client
        .update(eventOccurrences)
        .set(occurrenceUpdate)
        .where(eq(eventOccurrences.id, id))
        .returning();
      return occurrence || undefined;
    },

    async delete(id: string): Promise<boolean> {
      const client = getClient();
      const result = await client.delete(eventOccurrences).where(eq(eventOccurrences.id, id)).returning();
      return result.length > 0;
    },

    async deleteByEventId(eventId: string): Promise<number> {
      const client = getClient();
      const result = await client.delete(eventOccurrences).where(eq(eventOccurrences.eventId, eventId)).returning();
      return result.length;
    }
  };
}

export interface EventParticipantWithContact extends EventParticipant {
  contact: {
    id: string;
    given: string | null;
    family: string | null;
    displayName: string;
  } | null;
}

export interface EventParticipantStorage {
  getByEventId(eventId: string): Promise<EventParticipantWithContact[]>;
  get(id: string): Promise<EventParticipant | undefined>;
  getByEventAndContact(eventId: string, contactId: string): Promise<EventParticipant | undefined>;
  create(participant: InsertEventParticipant): Promise<EventParticipant>;
  update(id: string, participant: Partial<InsertEventParticipant>): Promise<EventParticipant | undefined>;
  delete(id: string): Promise<boolean>;
}

export const eventParticipantLoggingConfig: StorageLoggingConfig<EventParticipantStorage> = {
  module: 'eventParticipants',
  methods: {
    create: {
      enabled: true,
      getEntityId: (args) => args[0]?.eventId || 'new participant',
      getHostEntityId: (args) => args[0]?.eventId,
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

export function createEventParticipantStorage(): EventParticipantStorage {
  return {
    async getByEventId(eventId: string): Promise<EventParticipantWithContact[]> {
      const client = getClient();
      const results = await client
        .select({
          id: eventParticipants.id,
          eventId: eventParticipants.eventId,
          contactId: eventParticipants.contactId,
          role: eventParticipants.role,
          status: eventParticipants.status,
          data: eventParticipants.data,
          contact: {
            id: contacts.id,
            given: contacts.given,
            family: contacts.family,
            displayName: contacts.displayName,
          }
        })
        .from(eventParticipants)
        .leftJoin(contacts, eq(eventParticipants.contactId, contacts.id))
        .where(eq(eventParticipants.eventId, eventId));
      return results;
    },

    async get(id: string): Promise<EventParticipant | undefined> {
      const client = getClient();
      const [participant] = await client.select().from(eventParticipants).where(eq(eventParticipants.id, id));
      return participant || undefined;
    },

    async getByEventAndContact(eventId: string, contactId: string): Promise<EventParticipant | undefined> {
      const client = getClient();
      const [participant] = await client.select().from(eventParticipants)
        .where(and(
          eq(eventParticipants.eventId, eventId),
          eq(eventParticipants.contactId, contactId)
        ));
      return participant || undefined;
    },

    async create(insertParticipant: InsertEventParticipant): Promise<EventParticipant> {
      const client = getClient();
      const [participant] = await client.insert(eventParticipants).values(insertParticipant).returning();
      return participant;
    },

    async update(id: string, participantUpdate: Partial<InsertEventParticipant>): Promise<EventParticipant | undefined> {
      const client = getClient();
      const [participant] = await client
        .update(eventParticipants)
        .set(participantUpdate)
        .where(eq(eventParticipants.id, id))
        .returning();
      return participant || undefined;
    },

    async delete(id: string): Promise<boolean> {
      const client = getClient();
      const result = await client.delete(eventParticipants).where(eq(eventParticipants.id, id)).returning();
      return result.length > 0;
    }
  };
}
