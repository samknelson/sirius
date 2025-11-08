import { db } from "../db";
import { employerContacts, contacts, optionsEmployerContactType, type EmployerContact, type InsertEmployerContact, type Contact, type InsertContact } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { withStorageLogging, type StorageLoggingConfig } from "./middleware/logging";

export interface EmployerContactStorage {
  create(data: { employerId: string; contactData: InsertContact & { email: string }; contactTypeId?: string | null }): Promise<{ employerContact: EmployerContact; contact: Contact }>;
  listByEmployer(employerId: string): Promise<Array<EmployerContact & { contact: Contact; contactType?: { id: string; name: string; description: string | null } | null }>>;
  delete(id: string): Promise<boolean>;
}

export function createEmployerContactStorage(): EmployerContactStorage {
  return {
    async create(data: { employerId: string; contactData: InsertContact & { email: string }; contactTypeId?: string | null }): Promise<{ employerContact: EmployerContact; contact: Contact }> {
      // Validate email is provided
      if (!data.contactData.email || !data.contactData.email.trim()) {
        throw new Error("Email is required for employer contacts");
      }

      // Create the contact first
      const [contact] = await db
        .insert(contacts)
        .values(data.contactData)
        .returning();

      // Create the employer contact relationship
      const [employerContact] = await db
        .insert(employerContacts)
        .values({
          employerId: data.employerId,
          contactId: contact.id,
          contactTypeId: data.contactTypeId || null,
        })
        .returning();

      return { employerContact, contact };
    },

    async listByEmployer(employerId: string): Promise<Array<EmployerContact & { contact: Contact; contactType?: { id: string; name: string; description: string | null } | null }>> {
      const results = await db
        .select({
          employerContact: employerContacts,
          contact: contacts,
          contactType: optionsEmployerContactType,
        })
        .from(employerContacts)
        .innerJoin(contacts, eq(employerContacts.contactId, contacts.id))
        .leftJoin(optionsEmployerContactType, eq(employerContacts.contactTypeId, optionsEmployerContactType.id))
        .where(eq(employerContacts.employerId, employerId));

      return results.map(row => ({
        ...row.employerContact,
        contact: row.contact,
        contactType: row.contactType,
      }));
    },

    async delete(id: string): Promise<boolean> {
      const result = await db.delete(employerContacts).where(eq(employerContacts.id, id)).returning();
      return result.length > 0;
    },
  };
}

export const employerContactLoggingConfig: StorageLoggingConfig<EmployerContactStorage> = {
  module: 'employerContacts',
  methods: {
    create: {
      enabled: true,
      getEntityId: (args) => args[0]?.employerId || 'new employer contact',
      after: async (args, result, storage) => {
        return result;
      }
    },
    delete: {
      enabled: true,
      getEntityId: (args) => args[0],
      before: async (args, storage) => {
        const results = await db.select().from(employerContacts).where(eq(employerContacts.id, args[0]));
        return results[0];
      }
    }
  }
};
