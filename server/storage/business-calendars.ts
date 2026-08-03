import { getClient } from './transaction-context';
import {
  businessCalendars,
  businessCalendarManualByday,
  businessCalendarManualVacation,
  businessCalendarManualOpen,
  type BusinessCalendar,
  type InsertBusinessCalendar,
  type BusinessCalendarManualByday,
  type InsertBusinessCalendarManualByday,
  type BusinessCalendarManualVacation,
  type InsertBusinessCalendarManualVacation,
  type BusinessCalendarManualOpen,
  type InsertBusinessCalendarManualOpen,
} from "@shared/schema";
import { eq, asc } from "drizzle-orm";

export interface BusinessCalendarWithRules {
  calendar: BusinessCalendar;
  manualByday: BusinessCalendarManualByday[];
  manualVacations: BusinessCalendarManualVacation[];
  manualOpen: BusinessCalendarManualOpen[];
}

export interface BusinessCalendarStorage {
  getAll(): Promise<BusinessCalendar[]>;
  get(id: string): Promise<BusinessCalendar | undefined>;
  getBySiriusId(siriusId: string): Promise<BusinessCalendar | undefined>;
  create(data: InsertBusinessCalendar): Promise<BusinessCalendar>;
  update(id: string, data: Partial<InsertBusinessCalendar>): Promise<BusinessCalendar | undefined>;
  delete(id: string): Promise<boolean>;

  getCalendarWithRules(id: string): Promise<BusinessCalendarWithRules | undefined>;

  listManualByday(calendarId: string): Promise<BusinessCalendarManualByday[]>;
  createManualByday(data: InsertBusinessCalendarManualByday): Promise<BusinessCalendarManualByday>;
  deleteManualByday(id: string): Promise<boolean>;

  listManualVacations(calendarId: string): Promise<BusinessCalendarManualVacation[]>;
  createManualVacation(data: InsertBusinessCalendarManualVacation): Promise<BusinessCalendarManualVacation>;
  updateManualVacation(
    id: string,
    data: Partial<InsertBusinessCalendarManualVacation>,
  ): Promise<BusinessCalendarManualVacation | undefined>;
  deleteManualVacation(id: string): Promise<boolean>;

  listManualOpen(calendarId: string): Promise<BusinessCalendarManualOpen[]>;
  createManualOpen(data: InsertBusinessCalendarManualOpen): Promise<BusinessCalendarManualOpen>;
  deleteManualOpen(id: string): Promise<boolean>;
}

export function createBusinessCalendarStorage(): BusinessCalendarStorage {
  const storage: BusinessCalendarStorage = {
    async getAll(): Promise<BusinessCalendar[]> {
      const client = getClient();
      return await client.select().from(businessCalendars).orderBy(asc(businessCalendars.name));
    },

    async get(id: string): Promise<BusinessCalendar | undefined> {
      const client = getClient();
      const [row] = await client.select().from(businessCalendars).where(eq(businessCalendars.id, id));
      return row || undefined;
    },

    async getBySiriusId(siriusId: string): Promise<BusinessCalendar | undefined> {
      const client = getClient();
      const [row] = await client
        .select()
        .from(businessCalendars)
        .where(eq(businessCalendars.siriusId, siriusId));
      return row || undefined;
    },

    async create(data: InsertBusinessCalendar): Promise<BusinessCalendar> {
      const client = getClient();
      const [row] = await client.insert(businessCalendars).values(data).returning();
      return row;
    },

    async update(id: string, data: Partial<InsertBusinessCalendar>): Promise<BusinessCalendar | undefined> {
      const client = getClient();
      const [row] = await client
        .update(businessCalendars)
        .set(data)
        .where(eq(businessCalendars.id, id))
        .returning();
      return row || undefined;
    },

    async delete(id: string): Promise<boolean> {
      const client = getClient();
      const result = await client.delete(businessCalendars).where(eq(businessCalendars.id, id)).returning();
      return result.length > 0;
    },

    async getCalendarWithRules(id: string): Promise<BusinessCalendarWithRules | undefined> {
      const calendar = await storage.get(id);
      if (!calendar) return undefined;
      const [manualByday, manualVacations, manualOpen] = await Promise.all([
        storage.listManualByday(id),
        storage.listManualVacations(id),
        storage.listManualOpen(id),
      ]);
      return { calendar, manualByday, manualVacations, manualOpen };
    },

    async listManualByday(calendarId: string): Promise<BusinessCalendarManualByday[]> {
      const client = getClient();
      return await client
        .select()
        .from(businessCalendarManualByday)
        .where(eq(businessCalendarManualByday.calendarId, calendarId))
        .orderBy(asc(businessCalendarManualByday.ymd));
    },

    async createManualByday(data: InsertBusinessCalendarManualByday): Promise<BusinessCalendarManualByday> {
      const client = getClient();
      const [row] = await client.insert(businessCalendarManualByday).values(data).returning();
      return row;
    },

    async deleteManualByday(id: string): Promise<boolean> {
      const client = getClient();
      const result = await client
        .delete(businessCalendarManualByday)
        .where(eq(businessCalendarManualByday.id, id))
        .returning();
      return result.length > 0;
    },

    async listManualVacations(calendarId: string): Promise<BusinessCalendarManualVacation[]> {
      const client = getClient();
      return await client
        .select()
        .from(businessCalendarManualVacation)
        .where(eq(businessCalendarManualVacation.calendarId, calendarId))
        .orderBy(asc(businessCalendarManualVacation.startYmd));
    },

    async createManualVacation(
      data: InsertBusinessCalendarManualVacation,
    ): Promise<BusinessCalendarManualVacation> {
      const client = getClient();
      const [row] = await client.insert(businessCalendarManualVacation).values(data).returning();
      return row;
    },

    async updateManualVacation(
      id: string,
      data: Partial<InsertBusinessCalendarManualVacation>,
    ): Promise<BusinessCalendarManualVacation | undefined> {
      const client = getClient();
      const [row] = await client
        .update(businessCalendarManualVacation)
        .set(data)
        .where(eq(businessCalendarManualVacation.id, id))
        .returning();
      return row || undefined;
    },

    async deleteManualVacation(id: string): Promise<boolean> {
      const client = getClient();
      const result = await client
        .delete(businessCalendarManualVacation)
        .where(eq(businessCalendarManualVacation.id, id))
        .returning();
      return result.length > 0;
    },

    async listManualOpen(calendarId: string): Promise<BusinessCalendarManualOpen[]> {
      const client = getClient();
      return await client
        .select()
        .from(businessCalendarManualOpen)
        .where(eq(businessCalendarManualOpen.calendarId, calendarId))
        .orderBy(asc(businessCalendarManualOpen.ymd));
    },

    async createManualOpen(data: InsertBusinessCalendarManualOpen): Promise<BusinessCalendarManualOpen> {
      const client = getClient();
      const [row] = await client.insert(businessCalendarManualOpen).values(data).returning();
      return row;
    },

    async deleteManualOpen(id: string): Promise<boolean> {
      const client = getClient();
      const result = await client
        .delete(businessCalendarManualOpen)
        .where(eq(businessCalendarManualOpen.id, id))
        .returning();
      return result.length > 0;
    },
  };
  return storage;
}
