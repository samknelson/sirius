import { createNoopValidator } from '../../utils/validation';
import { getClient } from '../../transaction-context';
import { trustProviderContacts, contacts, optionsEmployerContactType, optionsTrustProviderType, trustProviders, type TrustProviderContact, type Contact, type TrustProvider } from "@shared/schema";
import { eq, and, or, ilike, sql } from "drizzle-orm";
import { withStorageLogging, type StorageLoggingConfig } from "../../middleware/logging";
import type { ContactsStorage } from "../../contacts";

/**
 * Stub validator - add validation logic here when needed
 */
export const validate = createNoopValidator();

export interface TrustProviderContactStorage {
  create(data: { contactId: string; providerId: string; contactTypeId?: string | null }): Promise<TrustProviderContact>;
  listByProvider(providerId: string): Promise<Array<TrustProviderContact & { contact: Contact; contactType?: { id: string; name: string; description: string | null } | null }>>;
  listByContactId(contactId: string): Promise<Array<TrustProviderContact & { contact: Contact; provider: TrustProvider; contactType?: { id: string; name: string; description: string | null } | null }>>;
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
  getByUserEmail(email: string): Promise<TrustProviderContact | null>;
  delete(id: string): Promise<boolean>;
}

export function createTrustProviderContactStorage(contactsStorage: ContactsStorage): TrustProviderContactStorage {
  return {
    async create(data: { contactId: string; providerId: string; contactTypeId?: string | null }): Promise<TrustProviderContact> {
      validate.validateOrThrow(data);
      const client = getClient();

      const [existingLink] = await client
        .select()
        .from(trustProviderContacts)
        .where(
          and(
            eq(trustProviderContacts.providerId, data.providerId),
            eq(trustProviderContacts.contactId, data.contactId)
          )
        )
        .limit(1);

      if (existingLink) {
        throw new Error("This contact is already linked to this provider");
      }

      const [providerContact] = await client
        .insert(trustProviderContacts)
        .values({
          providerId: data.providerId,
          contactId: data.contactId,
          contactTypeId: data.contactTypeId || null,
        })
        .returning();

      return providerContact;
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

    async listByContactId(contactId: string): Promise<Array<TrustProviderContact & { contact: Contact; provider: TrustProvider; contactType?: { id: string; name: string; description: string | null } | null }>> {
      const client = getClient();
      const results = await client
        .select({
          providerContact: trustProviderContacts,
          contact: contacts,
          provider: trustProviders,
          contactType: optionsTrustProviderType,
        })
        .from(trustProviderContacts)
        .innerJoin(contacts, eq(trustProviderContacts.contactId, contacts.id))
        .innerJoin(trustProviders, eq(trustProviderContacts.providerId, trustProviders.id))
        .leftJoin(optionsTrustProviderType, eq(trustProviderContacts.contactTypeId, optionsTrustProviderType.id))
        .where(eq(trustProviderContacts.contactId, contactId));

      return results.map(row => ({
        ...row.providerContact,
        contact: row.contact,
        provider: row.provider,
        contactType: row.contactType,
      }));
    },

    async getByUserEmail(email: string): Promise<TrustProviderContact | null> {
      const client = getClient();
      const [result] = await client
        .select({ id: trustProviderContacts.id })
        .from(trustProviderContacts)
        .innerJoin(contacts, eq(trustProviderContacts.contactId, contacts.id))
        .where(sql`LOWER(${contacts.email}) = LOWER(${email})`)
        .limit(1);
      return result ? { id: result.id } as TrustProviderContact : null;
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
      getHostEntityId: (args, result) => result?.providerId || args[0]?.providerId,
      before: async (args, storage) => {
        const existingLinks = await storage.listByContactId(args[0]?.contactId);
        return { existingLinkCount: existingLinks.length };
      },
      after: async (args, result, storage) => {
        return await storage.get(result.id);
      },
      getDescription: (args, result, beforeState, afterState) => {
        const contactName = afterState?.contact?.displayName || 'Unknown Contact';
        if (beforeState?.existingLinkCount > 0) {
          return `Linked existing contact "${contactName}" to additional trust provider`;
        }
        return `Created new trust provider contact "${contactName}"`;
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
