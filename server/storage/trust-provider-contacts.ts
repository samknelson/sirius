import { createNoopValidator } from './utils/validation';
import { getClient } from './transaction-context';
import { trustProviderContacts, contacts, optionsEmployerContactType, trustProviders, type TrustProviderContact, type InsertTrustProviderContact, type Contact, type InsertContact, type TrustProvider } from "@shared/schema";
import { eq, and, or, ilike } from "drizzle-orm";
import { withStorageLogging, type StorageLoggingConfig } from "./middleware/logging";
import type { ContactsStorage } from "./contacts";

/**
 * Stub validator - add validation logic here when needed
 */
export const validate = createNoopValidator();

export interface TrustProviderContactStorage {
  create(data: { providerId: string; contactData: InsertContact & { email: string }; contactTypeId?: string | null }): Promise<{ providerContact: TrustProviderContact; contact: Contact }>;
  listByProvider(providerId: string): Promise<Array<TrustProviderContact & { contact: Contact; contactType?: { id: string; name: string; description: string | null } | null }>>;
  getAll(filters?: { providerId?: string; contactName?: string; contactTypeId?: string }): Promise<Array<TrustProviderContact & { contact: Contact; provider: TrustProvider; contactType?: { id: string; name: string; description: string | null } | null }>>;
  get(id: string): Promise<(TrustProviderContact & { contact: Contact; contactType?: { id: string; name: string; description: string | null } | null }) | null>;
  update(id: string, data: { contactTypeId?: string | null }): Promise<(TrustProviderContact & { contact: Contact; contactType?: { id: string; name: string; description: string | null } | null }) | null>;
  updateContactEmail(id: string, email: string | null): Promise<(TrustProviderContact & { contact: Contact; contactType?: { id: string; name: string; description: string | null } | null }) | null>;
  updateContactName(id: string, components: {
    title?: string;
    given?: string;
    middle?: string;
    family?: string;
    generational?: string;
    credentials?: string;
  }): Promise<(TrustProviderContact & { contact: Contact; contactType?: { id: string; name: string; description: string | null } | null }) | null>;
  delete(id: string): Promise<boolean>;
}

export function createTrustProviderContactStorage(contactsStorage: ContactsStorage): TrustProviderContactStorage {
  return {
    async create(data: { providerId: string; contactData: InsertContact & { email: string }; contactTypeId?: string | null }): Promise<{ providerContact: TrustProviderContact; contact: Contact }> {
      validate.validateOrThrow(data);
      const client = getClient();
      // Validate email is provided
      if (!data.contactData.email || !data.contactData.email.trim()) {
        throw new Error("Email is required for provider contacts");
      }

      // Create the contact first
      const [contact] = await client
        .insert(contacts)
        .values(data.contactData)
        .returning();

      // Create the provider contact relationship
      const [providerContact] = await client
        .insert(trustProviderContacts)
        .values({
          providerId: data.providerId,
          contactId: contact.id,
          contactTypeId: data.contactTypeId || null,
        })
        .returning();

      return { providerContact, contact };
    },

    async listByProvider(providerId: string): Promise<Array<TrustProviderContact & { contact: Contact; contactType?: { id: string; name: string; description: string | null } | null }>> {
      const client = getClient();
      const results = await client
        .select({
          providerContact: trustProviderContacts,
          contact: contacts,
          contactType: optionsEmployerContactType,
        })
        .from(trustProviderContacts)
        .innerJoin(contacts, eq(trustProviderContacts.contactId, contacts.id))
        .leftJoin(optionsEmployerContactType, eq(trustProviderContacts.contactTypeId, optionsEmployerContactType.id))
        .where(eq(trustProviderContacts.providerId, providerId));

      return results.map(row => ({
        ...row.providerContact,
        contact: row.contact,
        contactType: row.contactType,
      }));
    },

    async getAll(filters?: { providerId?: string; contactName?: string; contactTypeId?: string }): Promise<Array<TrustProviderContact & { contact: Contact; provider: TrustProvider; contactType?: { id: string; name: string; description: string | null } | null }>> {
      const client = getClient();
      let query = client
        .select({
          providerContact: trustProviderContacts,
          contact: contacts,
          provider: trustProviders,
          contactType: optionsEmployerContactType,
        })
        .from(trustProviderContacts)
        .innerJoin(contacts, eq(trustProviderContacts.contactId, contacts.id))
        .innerJoin(trustProviders, eq(trustProviderContacts.providerId, trustProviders.id))
        .leftJoin(optionsEmployerContactType, eq(trustProviderContacts.contactTypeId, optionsEmployerContactType.id));

      const conditions = [];

      if (filters?.providerId) {
        conditions.push(eq(trustProviderContacts.providerId, filters.providerId));
      }

      if (filters?.contactTypeId) {
        conditions.push(eq(trustProviderContacts.contactTypeId, filters.contactTypeId));
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
        ...row.providerContact,
        contact: row.contact,
        provider: row.provider,
        contactType: row.contactType,
      }));
    },

    async get(id: string): Promise<(TrustProviderContact & { contact: Contact; contactType?: { id: string; name: string; description: string | null } | null }) | null> {
      const client = getClient();
      const results = await client
        .select({
          providerContact: trustProviderContacts,
          contact: contacts,
          contactType: optionsEmployerContactType,
        })
        .from(trustProviderContacts)
        .innerJoin(contacts, eq(trustProviderContacts.contactId, contacts.id))
        .leftJoin(optionsEmployerContactType, eq(trustProviderContacts.contactTypeId, optionsEmployerContactType.id))
        .where(eq(trustProviderContacts.id, id));

      if (results.length === 0) {
        return null;
      }

      const row = results[0];
      return {
        ...row.providerContact,
        contact: row.contact,
        contactType: row.contactType,
      };
    },

    async update(id: string, data: { contactTypeId?: string | null }): Promise<(TrustProviderContact & { contact: Contact; contactType?: { id: string; name: string; description: string | null } | null }) | null> {
      const client = getClient();
      const [updated] = await client
        .update(trustProviderContacts)
        .set({ contactTypeId: data.contactTypeId })
        .where(eq(trustProviderContacts.id, id))
        .returning();

      if (!updated) {
        return null;
      }

      return this.get(id);
    },

    async updateContactEmail(id: string, email: string | null): Promise<(TrustProviderContact & { contact: Contact; contactType?: { id: string; name: string; description: string | null } | null }) | null> {
      const client = getClient();
      const providerContact = await client.query.trustProviderContacts.findFirst({
        where: eq(trustProviderContacts.id, id),
      });

      if (!providerContact) {
        return null;
      }

      const normalizedEmail = email === null || email === "null" || email?.trim() === "" ? null : email.trim();

      await client
        .update(contacts)
        .set({ email: normalizedEmail })
        .where(eq(contacts.id, providerContact.contactId));

      return this.get(id);
    },

    async updateContactName(id: string, components: {
      title?: string;
      given?: string;
      middle?: string;
      family?: string;
      generational?: string;
      credentials?: string;
    }): Promise<(TrustProviderContact & { contact: Contact; contactType?: { id: string; name: string; description: string | null } | null }) | null> {
      const providerContact = await this.get(id);
      if (!providerContact) {
        return null;
      }

      await contactsStorage.updateNameComponents(providerContact.contactId, components);
      return this.get(id);
    },

    async delete(id: string): Promise<boolean> {
      const client = getClient();
      const result = await client
        .delete(trustProviderContacts)
        .where(eq(trustProviderContacts.id, id))
        .returning();

      return result.length > 0;
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

export const trustProviderContactLoggingConfig: StorageLoggingConfig<TrustProviderContactStorage> = {
  module: 'trustProviderContacts',
  methods: {
    create: {
      enabled: true,
      getEntityId: (args) => args[0]?.providerId || 'new trust provider contact',
      getHostEntityId: (args, result) => result?.providerContact?.providerId || args[0]?.providerId, // Provider ID is the host
      after: async (args, result, storage) => {
        return result;
      },
      getDescription: (args, result, beforeState, afterState) => {
        const contactName = afterState?.contact?.displayName || 'Unknown Contact';
        return `Created trust provider contact "${contactName}"`;
      }
    },
    update: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: (args, result, beforeState) => result?.providerId || beforeState?.providerId, // Provider ID is the host
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
          return `Updated trust provider contact "${contactName}" (no changes detected)`;
        }
        
        const fieldList = changedFields.join(', ');
        return `Updated trust provider contact "${contactName}" (changed: ${fieldList})`;
      }
    },
    updateContactEmail: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: (args, result, beforeState) => result?.providerId || beforeState?.providerId, // Provider ID is the host
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
          return `Updated trust provider contact "${contactName}" (no changes detected)`;
        }
        
        const fieldList = changedFields.join(', ');
        return `Updated trust provider contact "${contactName}" (changed: ${fieldList})`;
      }
    },
    updateContactName: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: (args, result, beforeState) => result?.providerId || beforeState?.providerId, // Provider ID is the host
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
          return `Updated trust provider contact "${contactName}" (no changes detected)`;
        }
        
        const fieldList = changedFields.join(', ');
        return `Updated trust provider contact "${contactName}" (changed: ${fieldList})`;
      }
    },
    delete: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: (args, result, beforeState) => beforeState?.providerId, // Provider ID is the host
      before: async (args, storage) => {
        return await storage.get(args[0]);
      },
      getDescription: (args, result, beforeState, afterState) => {
        const contactName = beforeState?.contact?.displayName || 'Unknown Contact';
        return `Deleted trust provider contact "${contactName}"`;
      }
    }
  }
};
