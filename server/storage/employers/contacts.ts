import { getClient } from '../transaction-context';
import { employerContacts, contacts, optionsEmployerContactType, employers, users, type EmployerContact, type InsertEmployerContact, type Contact, type Employer } from "@shared/schema";
import { eq, and, or, like, ilike, sql, inArray } from "drizzle-orm";
import { withStorageLogging, type StorageLoggingConfig } from "../middleware/logging";
import type { ContactsStorage } from "../contacts";

export interface EmployerContactStorage {
  create(data: { contactId: string; employerId: string; contactTypeId?: string | null }): Promise<EmployerContact>;
  listByEmployer(employerId: string): Promise<Array<EmployerContact & { contact: Contact; contactType?: { id: string; name: string; description: string | null } | null }>>;
  listByContactId(contactId: string): Promise<Array<EmployerContact & { contact: Contact; employer: Employer; contactType?: { id: string; name: string; description: string | null } | null }>>;
  getAll(filters?: { employerId?: string; contactName?: string; contactTypeId?: string }): Promise<Array<EmployerContact & { contact: Contact; employer: Employer; contactType?: { id: string; name: string; description: string | null } | null }>>;
  getByEmployerIds(employerIds: string[], contactTypeIds?: string[]): Promise<Array<{ employerContactId: string; employerId: string; contactId: string; contactTypeId: string | null; displayName: string | null; email: string | null }>>;
  get(id: string): Promise<(EmployerContact & { contact: Contact; contactType?: { id: string; name: string; description: string | null } | null }) | null>;
  update(id: string, data: { contactTypeId?: string | null }): Promise<(EmployerContact & { contact: Contact; contactType?: { id: string; name: string; description: string | null } | null }) | null>;
  updateContactEmail(id: string, email: string | null): Promise<(EmployerContact & { contact: Contact; contactType?: { id: string; name: string; description: string | null } | null }) | null>;
  updateContactName(id: string, components: {
    title?: string;
    given?: string;
    middle?: string;
    family?: string;
    generational?: string;
    credentials?: string;
  }): Promise<(EmployerContact & { contact: Contact; contactType?: { id: string; name: string; description: string | null } | null }) | null>;
  getByUserEmail(email: string): Promise<EmployerContact | null>;
  delete(id: string): Promise<boolean>;
  getUserAccountStatuses(employerContactIds: string[]): Promise<Array<{ employerContactId: string; userId: string | null; hasUser: boolean; accountStatus: string | null }>>;
  getContactIndicatorsByEmployer(employerIds?: string[]): Promise<Array<{ employerId: string; contactId: string; contactName: string | null; contactTypeName: string | null; icon: string | null; hasActiveUser: boolean }>>;
}

export function createEmployerContactStorage(contactsStorage: ContactsStorage): EmployerContactStorage {
  return {
    async create(data: { contactId: string; employerId: string; contactTypeId?: string | null }): Promise<EmployerContact> {
      const client = getClient();

      const [existingLink] = await client
        .select()
        .from(employerContacts)
        .where(
          and(
            eq(employerContacts.employerId, data.employerId),
            eq(employerContacts.contactId, data.contactId)
          )
        )
        .limit(1);

      if (existingLink) {
        throw new Error("This contact is already linked to this employer");
      }

      const [employerContact] = await client
        .insert(employerContacts)
        .values({
          employerId: data.employerId,
          contactId: data.contactId,
          contactTypeId: data.contactTypeId || null,
        })
        .returning();

      return employerContact;
    },

    async listByEmployer(employerId: string): Promise<Array<EmployerContact & { contact: Contact; contactType?: { id: string; name: string; description: string | null } | null }>> {
      const client = getClient();
      const results = await client
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

    async listByContactId(contactId: string): Promise<Array<EmployerContact & { contact: Contact; employer: Employer; contactType?: { id: string; name: string; description: string | null } | null }>> {
      const client = getClient();
      const results = await client
        .select({
          employerContact: employerContacts,
          contact: contacts,
          employer: employers,
          contactType: optionsEmployerContactType,
        })
        .from(employerContacts)
        .innerJoin(contacts, eq(employerContacts.contactId, contacts.id))
        .innerJoin(employers, eq(employerContacts.employerId, employers.id))
        .leftJoin(optionsEmployerContactType, eq(employerContacts.contactTypeId, optionsEmployerContactType.id))
        .where(eq(employerContacts.contactId, contactId));

      return results.map(row => ({
        ...row.employerContact,
        contact: row.contact,
        employer: row.employer,
        contactType: row.contactType,
      }));
    },

    async getAll(filters?: { employerId?: string; contactName?: string; contactTypeId?: string }): Promise<Array<EmployerContact & { contact: Contact; employer: Employer; contactType?: { id: string; name: string; description: string | null; data: unknown } | null }>> {
      const client = getClient();
      let query = client
        .select({
          employerContact: employerContacts,
          contact: contacts,
          employer: employers,
          contactType: optionsEmployerContactType,
        })
        .from(employerContacts)
        .innerJoin(contacts, eq(employerContacts.contactId, contacts.id))
        .innerJoin(employers, eq(employerContacts.employerId, employers.id))
        .leftJoin(optionsEmployerContactType, eq(employerContacts.contactTypeId, optionsEmployerContactType.id));

      const conditions = [];

      if (filters?.employerId) {
        conditions.push(eq(employerContacts.employerId, filters.employerId));
      }

      if (filters?.contactTypeId) {
        conditions.push(eq(employerContacts.contactTypeId, filters.contactTypeId));
      }

      if (filters?.contactName) {
        const searchTerm = `%${filters.contactName}%`;
        conditions.push(
          or(
            ilike(contacts.displayName, searchTerm),
            ilike(contacts.given, searchTerm),
            ilike(contacts.family, searchTerm),
            ilike(contacts.email, searchTerm)
          )!
        );
      }

      if (conditions.length > 0) {
        query = query.where(and(...conditions)!) as any;
      }

      const results = await query;

      return results.map(row => ({
        ...row.employerContact,
        contact: row.contact,
        employer: row.employer,
        contactType: row.contactType,
      }));
    },

    async getByEmployerIds(employerIds: string[], contactTypeIds?: string[]): Promise<Array<{ employerContactId: string; employerId: string; contactId: string; contactTypeId: string | null; displayName: string | null; email: string | null }>> {
      if (employerIds.length === 0) return [];
      const client = getClient();
      const conditions = [inArray(employerContacts.employerId, employerIds)];
      if (contactTypeIds && contactTypeIds.length > 0) {
        conditions.push(inArray(employerContacts.contactTypeId, contactTypeIds));
      }
      const rows = await client
        .select({
          employerContactId: employerContacts.id,
          employerId: employerContacts.employerId,
          contactId: employerContacts.contactId,
          contactTypeId: employerContacts.contactTypeId,
          displayName: contacts.displayName,
          email: contacts.email,
        })
        .from(employerContacts)
        .innerJoin(contacts, eq(employerContacts.contactId, contacts.id))
        .where(and(...conditions));
      return rows;
    },

    async get(id: string): Promise<(EmployerContact & { contact: Contact; contactType?: { id: string; name: string; description: string | null } | null }) | null> {
      const client = getClient();
      const results = await client
        .select({
          employerContact: employerContacts,
          contact: contacts,
          contactType: optionsEmployerContactType,
        })
        .from(employerContacts)
        .innerJoin(contacts, eq(employerContacts.contactId, contacts.id))
        .leftJoin(optionsEmployerContactType, eq(employerContacts.contactTypeId, optionsEmployerContactType.id))
        .where(eq(employerContacts.id, id));

      if (results.length === 0) {
        return null;
      }

      const row = results[0];
      return {
        ...row.employerContact,
        contact: row.contact,
        contactType: row.contactType,
      };
    },

    async update(id: string, data: { contactTypeId?: string | null }): Promise<(EmployerContact & { contact: Contact; contactType?: { id: string; name: string; description: string | null } | null }) | null> {
      const client = getClient();
      const [updated] = await client
        .update(employerContacts)
        .set({ contactTypeId: data.contactTypeId })
        .where(eq(employerContacts.id, id))
        .returning();

      if (!updated) {
        return null;
      }

      return this.get(id);
    },

    async updateContactEmail(id: string, email: string | null): Promise<(EmployerContact & { contact: Contact; contactType?: { id: string; name: string; description: string | null } | null }) | null> {
      const client = getClient();
      const employerContact = await client.query.employerContacts.findFirst({
        where: eq(employerContacts.id, id),
      });

      if (!employerContact) {
        return null;
      }

      const normalizedEmail = email === null || email === "null" || email?.trim() === "" ? null : email.trim();

      // Use contacts storage to update email
      await contactsStorage.updateEmail(employerContact.contactId, normalizedEmail);

      return this.get(id);
    },

    async updateContactName(
      id: string,
      components: {
        title?: string;
        given?: string;
        middle?: string;
        family?: string;
        generational?: string;
        credentials?: string;
      }
    ): Promise<(EmployerContact & { contact: Contact; contactType?: { id: string; name: string; description: string | null } | null }) | null> {
      const client = getClient();
      const employerContact = await client.query.employerContacts.findFirst({
        where: eq(employerContacts.id, id),
      });

      if (!employerContact) {
        return null;
      }

      await contactsStorage.updateNameComponents(employerContact.contactId, components);

      return this.get(id);
    },

    async getByUserEmail(email: string): Promise<EmployerContact | null> {
      const client = getClient();
      const [result] = await client
        .select({ id: employerContacts.id })
        .from(employerContacts)
        .innerJoin(contacts, eq(employerContacts.contactId, contacts.id))
        .where(sql`LOWER(${contacts.email}) = LOWER(${email})`)
        .limit(1);
      return result ? { id: result.id } as EmployerContact : null;
    },

    async delete(id: string): Promise<boolean> {
      const client = getClient();
      const result = await client.delete(employerContacts).where(eq(employerContacts.id, id)).returning();
      return result.length > 0;
    },

    async getUserAccountStatuses(employerContactIds: string[]): Promise<Array<{ employerContactId: string; userId: string | null; hasUser: boolean; accountStatus: string | null }>> {
      const client = getClient();
      if (employerContactIds.length === 0) {
        return [];
      }

      const results = await client
        .select({
          employerContactId: employerContacts.id,
          userId: users.id,
          accountStatus: users.accountStatus,
        })
        .from(employerContacts)
        .innerJoin(contacts, eq(employerContacts.contactId, contacts.id))
        .leftJoin(users, sql`lower(${contacts.email}) = lower(${users.email})`)
        .where(inArray(employerContacts.id, employerContactIds));

      // Map results and maintain input order
      const resultMap = new Map(
        results.map(row => [
          row.employerContactId,
          {
            employerContactId: row.employerContactId,
            userId: row.userId,
            hasUser: row.userId !== null,
            accountStatus: row.accountStatus,
          },
        ])
      );

      // Return results in the same order as input IDs
      return employerContactIds.map(id => 
        resultMap.get(id) || {
          employerContactId: id,
          userId: null,
          hasUser: false,
          accountStatus: null,
        }
      );
    },

    async getContactIndicatorsByEmployer(employerIds?: string[]): Promise<Array<{ employerId: string; contactId: string; contactName: string | null; contactTypeName: string | null; icon: string | null; hasActiveUser: boolean }>> {
      const client = getClient();

      const rows = await client
        .select({
          employerId: employerContacts.employerId,
          contactId: contacts.id,
          contactName: contacts.displayName,
          contactTypeName: optionsEmployerContactType.name,
          icon: sql<string | null>`${optionsEmployerContactType.data}->>'icon'`,
          userId: users.id,
          isActive: users.isActive,
        })
        .from(employerContacts)
        .innerJoin(contacts, eq(employerContacts.contactId, contacts.id))
        .leftJoin(optionsEmployerContactType, eq(employerContacts.contactTypeId, optionsEmployerContactType.id))
        .leftJoin(users, sql`lower(${contacts.email}) = lower(${users.email})`)
        .where(employerIds && employerIds.length > 0 ? inArray(employerContacts.employerId, employerIds) : undefined);

      return rows.map(row => ({
        employerId: row.employerId,
        contactId: row.contactId,
        contactName: row.contactName,
        contactTypeName: row.contactTypeName,
        icon: row.icon,
        hasActiveUser: row.userId !== null && row.isActive === true,
      }));
    },
  };
}

/**
 * Helper function to calculate changes between before and after states
 */
function calculateChanges(before: any, after: any): Record<string, { from: any; to: any }> {
  if (before === null || before === undefined || after === null || after === undefined) {
    return {};
  }

  if (typeof before !== 'object' || typeof after !== 'object') {
    return before !== after ? { value: { from: before, to: after } } : {};
  }

  const changes: Record<string, { from: any; to: any }> = {};
  const allKeys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]));

  for (const key of allKeys) {
    const beforeValue = before[key];
    const afterValue = after[key];

    if (JSON.stringify(beforeValue) !== JSON.stringify(afterValue)) {
      changes[key] = { from: beforeValue, to: afterValue };
    }
  }

  return changes;
}

export const employerContactLoggingConfig: StorageLoggingConfig<EmployerContactStorage> = {
  module: 'employerContacts',
  methods: {
    create: {
      enabled: true,
      getEntityId: (args) => args[0]?.contactId || 'new employer contact',
      getHostEntityId: (args, result) => result?.employerId || args[0]?.employerId,
      after: async (args, result, storage) => {
        return await storage.get(result.id);
      },
      getDescription: (args, result, beforeState, afterState) => {
        const contactName = afterState?.contact?.displayName || 'Unknown Contact';
        return `Created employer contact "${contactName}"`;
      }
    },
    update: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: (args, result, beforeState) => result?.employerId || beforeState?.employerId, // Employer ID is the host
      before: async (args, storage) => {
        return await storage.get(args[0]);
      },
      after: async (args, result, storage) => {
        return result;
      },
      getDescription: (args, result, beforeState, afterState) => {
        const contactName = afterState?.contact?.displayName || beforeState?.contact?.displayName || 'Unknown Contact';
        const changes = calculateChanges(beforeState, afterState);
        const changedFields = Object.keys(changes);
        
        if (changedFields.length === 0) {
          return `Updated employer contact "${contactName}" (no changes detected)`;
        }
        
        const fieldList = changedFields.join(', ');
        return `Updated employer contact "${contactName}" (changed: ${fieldList})`;
      }
    },
    updateContactEmail: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: (args, result, beforeState) => result?.employerId || beforeState?.employerId, // Employer ID is the host
      before: async (args, storage) => {
        return await storage.get(args[0]);
      },
      after: async (args, result, storage) => {
        return await storage.get(args[0]);
      },
      getDescription: (args, result, beforeState, afterState) => {
        const contactName = afterState?.contact?.displayName || beforeState?.contact?.displayName || 'Unknown Contact';
        const changes = calculateChanges(beforeState, afterState);
        const changedFields = Object.keys(changes);
        
        if (changedFields.length === 0) {
          return `Updated employer contact "${contactName}" (no changes detected)`;
        }
        
        const fieldList = changedFields.join(', ');
        return `Updated employer contact "${contactName}" (changed: ${fieldList})`;
      }
    },
    updateContactName: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: (args, result, beforeState) => result?.employerId || beforeState?.employerId, // Employer ID is the host
      before: async (args, storage) => {
        return await storage.get(args[0]);
      },
      after: async (args, result, storage) => {
        return await storage.get(args[0]);
      },
      getDescription: (args, result, beforeState, afterState) => {
        const contactName = afterState?.contact?.displayName || beforeState?.contact?.displayName || 'Unknown Contact';
        const changes = calculateChanges(beforeState, afterState);
        const changedFields = Object.keys(changes);
        
        if (changedFields.length === 0) {
          return `Updated employer contact "${contactName}" (no changes detected)`;
        }
        
        const fieldList = changedFields.join(', ');
        return `Updated employer contact "${contactName}" (changed: ${fieldList})`;
      }
    },
    delete: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: (args, result, beforeState) => beforeState?.employerId, // Employer ID is the host
      before: async (args, storage) => {
        return await storage.get(args[0]);
      },
      getDescription: (args, result, beforeState, afterState) => {
        const contactName = beforeState?.contact?.displayName || 'Unknown Contact';
        return `Deleted employer contact "${contactName}"`;
      }
    }
  }
};
