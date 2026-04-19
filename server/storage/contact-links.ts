import { getClient } from "./transaction-context";
import { workers, employers, employerContacts, trustProviders, trustProviderContacts, contacts } from "@shared/schema";
import { eq, inArray, asc } from "drizzle-orm";

export interface ContactLinkWorkerRow {
  id: string;
  contactId: string;
}

export interface ContactLinkEmployerRow {
  id: string;
  contactId: string;
  employerName: string;
}

export interface ContactLinkProviderRow {
  id: string;
  contactId: string;
  providerName: string;
}

export interface ContactLinkNameRow {
  id: string;
  displayName: string | null;
}

export interface ContactLinkStorage {
  getWorkersByContactIds(contactIds: string[]): Promise<ContactLinkWorkerRow[]>;
  getEmployerContactsByContactIds(contactIds: string[]): Promise<ContactLinkEmployerRow[]>;
  getTrustProviderContactsByContactIds(contactIds: string[]): Promise<ContactLinkProviderRow[]>;
  getContactNames(contactIds: string[]): Promise<ContactLinkNameRow[]>;
}

export function createContactLinkStorage(): ContactLinkStorage {
  return {
    async getWorkersByContactIds(contactIds: string[]): Promise<ContactLinkWorkerRow[]> {
      if (contactIds.length === 0) return [];
      const client = getClient();
      return await client
        .select({ id: workers.id, contactId: workers.contactId })
        .from(workers)
        .where(inArray(workers.contactId, contactIds));
    },

    async getEmployerContactsByContactIds(contactIds: string[]): Promise<ContactLinkEmployerRow[]> {
      if (contactIds.length === 0) return [];
      const client = getClient();
      return await client
        .select({
          id: employerContacts.id,
          contactId: employerContacts.contactId,
          employerName: employers.name,
        })
        .from(employerContacts)
        .innerJoin(employers, eq(employers.id, employerContacts.employerId))
        .where(inArray(employerContacts.contactId, contactIds))
        .orderBy(asc(employers.name));
    },

    async getTrustProviderContactsByContactIds(contactIds: string[]): Promise<ContactLinkProviderRow[]> {
      if (contactIds.length === 0) return [];
      const client = getClient();
      return await client
        .select({
          id: trustProviderContacts.id,
          contactId: trustProviderContacts.contactId,
          providerName: trustProviders.name,
        })
        .from(trustProviderContacts)
        .innerJoin(trustProviders, eq(trustProviders.id, trustProviderContacts.providerId))
        .where(inArray(trustProviderContacts.contactId, contactIds))
        .orderBy(asc(trustProviders.name));
    },

    async getContactNames(contactIds: string[]): Promise<ContactLinkNameRow[]> {
      if (contactIds.length === 0) return [];
      const client = getClient();
      return await client
        .select({ id: contacts.id, displayName: contacts.displayName })
        .from(contacts)
        .where(inArray(contacts.id, contactIds));
    },
  };
}
