import { createNoopValidator } from '../utils/validation';
import { getClient } from '../transaction-context';
import {
  facilities,
  contacts,
  type Facility,
  type Contact,
  type InsertContact,
  type InsertFacility,
} from "@shared/schema";
import { eq, asc, desc, sql, SQL, and, ilike } from "drizzle-orm";
import { type StorageLoggingConfig } from "../middleware/logging";
import type { ContactsStorage } from "../contacts";

export interface FacilityNameComponents {
  title?: string;
  given?: string;
  middle?: string;
  family?: string;
  generational?: string;
  credentials?: string;
}

export const validate = createNoopValidator<InsertFacility, Facility>();

export interface FacilityFilters {
  search?: string;
  contactId?: string;
  sort?: 'name';
  sortDir?: 'asc' | 'desc';
}

export interface PaginatedFacilities {
  data: Facility[];
  total: number;
  page: number;
  limit: number;
}

export type FacilityWithContact = Facility & { contact: Contact };

export interface CreateFacilityInput {
  name: string;
  siriusId?: string | null;
  data?: unknown;
}

export interface UpdateFacilityInput {
  name?: string;
  siriusId?: string | null;
  data?: unknown;
}

export interface FacilityStorage {
  getAll(): Promise<Facility[]>;
  getPaginated(page: number, limit: number, filters?: FacilityFilters): Promise<PaginatedFacilities>;
  get(id: string): Promise<Facility | undefined>;
  getWithContact(id: string): Promise<FacilityWithContact | undefined>;
  getBySiriusId(siriusId: string): Promise<Facility | undefined>;
  create(input: CreateFacilityInput): Promise<Facility>;
  update(id: string, input: UpdateFacilityInput): Promise<Facility | undefined>;
  updateContactEmail(id: string, email: string | null): Promise<Facility | undefined>;
  updateContactName(id: string, name: string): Promise<Facility | undefined>;
  updateContactNameComponents(id: string, components: FacilityNameComponents): Promise<Facility | undefined>;
  delete(id: string): Promise<boolean>;
}

export const facilityLoggingConfig: StorageLoggingConfig<FacilityStorage> = {
  module: 'facilities',
  methods: {
    create: {
      enabled: true,
      getEntityId: (args, result) => result?.id || 'new facility',
      getHostEntityId: (args, result) => result?.id,
      getDescription: async (args, result) => {
        const name = result?.name || args[0]?.name || 'Unnamed';
        return `Created Facility "${name}"`;
      },
      after: async (args, result) => ({
        facility: result,
        metadata: { facilityId: result?.id, name: result?.name },
      }),
    },
    update: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: (args) => args[0],
      getDescription: async (args, result, beforeState) => {
        const name = result?.name || beforeState?.facility?.name || 'Unknown';
        return `Updated Facility "${name}"`;
      },
      before: async (args, storage) => {
        const facility = await storage.get(args[0]);
        return facility ? { facility } : null;
      },
      after: async (args, result, storage, beforeState) => ({
        facility: result,
        previousState: beforeState?.facility,
        metadata: { facilityId: result?.id, name: result?.name },
      }),
    },
    updateContactEmail: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: (args) => args[0],
      getDescription: async (args, result, beforeState) => {
        const name = result?.name || beforeState?.facility?.name || 'Unknown';
        return `Updated Facility "${name}" email`;
      },
      before: async (args, storage) => {
        const facility = await storage.get(args[0]);
        return facility ? { facility } : null;
      },
    },
    updateContactName: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: (args) => args[0],
      getDescription: async (args, result, beforeState) => {
        const name = result?.name || beforeState?.facility?.name || 'Unknown';
        return `Updated Facility "${name}" contact name`;
      },
      before: async (args, storage) => {
        const facility = await storage.get(args[0]);
        return facility ? { facility } : null;
      },
    },
    updateContactNameComponents: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: (args) => args[0],
      getDescription: async (args, result, beforeState) => {
        const name = result?.name || beforeState?.facility?.name || 'Unknown';
        return `Updated Facility "${name}" contact name components`;
      },
      before: async (args, storage) => {
        const facility = await storage.get(args[0]);
        return facility ? { facility } : null;
      },
    },
    delete: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: (args) => args[0],
      getDescription: async (args, result, beforeState) => {
        const name = beforeState?.facility?.name || 'Unknown';
        return `Deleted Facility "${name}"`;
      },
      before: async (args, storage) => {
        const facility = await storage.get(args[0]);
        return facility ? { facility } : null;
      },
    },
  },
};

export function createFacilityStorage(contactsStorage: ContactsStorage): FacilityStorage {
  const storage: FacilityStorage = {
    async getAll(): Promise<Facility[]> {
      const client = getClient();
      return client.select().from(facilities).orderBy(asc(facilities.name));
    },

    async getPaginated(page: number, limit: number, filters?: FacilityFilters): Promise<PaginatedFacilities> {
      const client = getClient();
      const conditions: SQL[] = [];

      if (filters?.search) {
        conditions.push(ilike(facilities.name, `%${filters.search}%`));
      }
      if (filters?.contactId) {
        conditions.push(eq(facilities.contactId, filters.contactId));
      }

      const sortCol = facilities.name;
      const orderFn = filters?.sortDir === 'desc' ? desc : asc;

      const hasFilters = conditions.length > 0;
      const whereClause = hasFilters ? and(...conditions) : undefined;

      const countQuery = client
        .select({ count: sql<number>`count(*)::int` })
        .from(facilities);
      const [countResult] = hasFilters
        ? await countQuery.where(whereClause!)
        : await countQuery;
      const total = countResult?.count || 0;

      const baseQuery = client.select().from(facilities);
      const data = hasFilters
        ? await baseQuery.where(whereClause!).orderBy(orderFn(sortCol)).limit(limit).offset(page * limit)
        : await baseQuery.orderBy(orderFn(sortCol)).limit(limit).offset(page * limit);

      return { data, total, page, limit };
    },

    async get(id: string): Promise<Facility | undefined> {
      const client = getClient();
      const [facility] = await client.select().from(facilities).where(eq(facilities.id, id));
      return facility || undefined;
    },

    async getWithContact(id: string): Promise<FacilityWithContact | undefined> {
      const client = getClient();
      const [row] = await client
        .select({ facility: facilities, contact: contacts })
        .from(facilities)
        .innerJoin(contacts, eq(facilities.contactId, contacts.id))
        .where(eq(facilities.id, id));
      if (!row) return undefined;
      return { ...row.facility, contact: row.contact };
    },

    async getBySiriusId(siriusId: string): Promise<Facility | undefined> {
      const client = getClient();
      const [facility] = await client.select().from(facilities).where(eq(facilities.siriusId, siriusId));
      return facility || undefined;
    },

    async create(input: CreateFacilityInput): Promise<Facility> {
      const trimmedName = (input.name || '').trim();
      if (!trimmedName) {
        throw new Error('Facility name is required');
      }
      const client = getClient();
      const contactPayload: InsertContact = {
        given: '',
        family: trimmedName,
        displayName: trimmedName,
      };
      const contact = await contactsStorage.createContact(contactPayload);
      const [facility] = await client
        .insert(facilities)
        .values({
          name: trimmedName,
          siriusId: input.siriusId ?? null,
          data: input.data ?? null,
          contactId: contact.id,
        })
        .returning();
      return facility;
    },

    async update(id: string, input: UpdateFacilityInput): Promise<Facility | undefined> {
      const client = getClient();
      const [existing] = await client.select().from(facilities).where(eq(facilities.id, id));
      if (!existing) return undefined;

      const updates: Partial<InsertFacility> = {};
      if (input.name !== undefined) {
        const trimmed = input.name.trim();
        if (!trimmed) throw new Error('Facility name cannot be empty');
        updates.name = trimmed;
      }
      if (input.siriusId !== undefined) {
        updates.siriusId = input.siriusId ?? null;
      }
      if (input.data !== undefined) {
        updates.data = input.data ?? null;
      }

      if (Object.keys(updates).length === 0) {
        return existing;
      }

      const [facility] = await client
        .update(facilities)
        .set(updates)
        .where(eq(facilities.id, id))
        .returning();

      if (updates.name && existing.contactId) {
        await contactsStorage.updateName(existing.contactId, updates.name);
      }

      return facility || undefined;
    },

    async updateContactEmail(id: string, email: string | null): Promise<Facility | undefined> {
      const facility = await this.get(id);
      if (!facility) return undefined;
      const normalized = email === null || email === 'null' || email?.trim() === '' ? null : email.trim();
      await contactsStorage.updateEmail(facility.contactId, normalized);
      return facility;
    },

    async updateContactName(id: string, name: string): Promise<Facility | undefined> {
      const trimmed = name.trim();
      if (!trimmed) throw new Error('Facility name cannot be empty');
      const facility = await this.get(id);
      if (!facility) return undefined;
      // Sync contact name and the facility.name (kept in sync as the canonical label).
      await contactsStorage.updateName(facility.contactId, trimmed);
      const client = getClient();
      const [updated] = await client
        .update(facilities)
        .set({ name: trimmed })
        .where(eq(facilities.id, id))
        .returning();
      return updated || undefined;
    },

    async updateContactNameComponents(
      id: string,
      components: FacilityNameComponents,
    ): Promise<Facility | undefined> {
      const facility = await this.get(id);
      if (!facility) return undefined;
      const updatedContact = await contactsStorage.updateNameComponents(
        facility.contactId,
        components,
      );
      if (!updatedContact) return undefined;
      const newName = (updatedContact.displayName || '').trim() || facility.name;
      if (newName === facility.name) return facility;
      const client = getClient();
      const [updated] = await client
        .update(facilities)
        .set({ name: newName })
        .where(eq(facilities.id, id))
        .returning();
      return updated || facility;
    },

    async delete(id: string): Promise<boolean> {
      const client = getClient();
      const [existing] = await client.select().from(facilities).where(eq(facilities.id, id));
      if (!existing) return false;
      const result = await client.delete(facilities).where(eq(facilities.id, id)).returning();
      if (result.length > 0 && existing.contactId) {
        // The contacts row is owned by the facility, so cascade-delete it. If
        // another entity still references it (e.g. a worker contact), this will
        // surface as an FK error and we surface that to the caller's logs.
        try {
          await contactsStorage.deleteContact(existing.contactId);
        } catch (error) {
          console.error(
            `Failed to delete contact ${existing.contactId} for facility ${id}:`,
            error,
          );
        }
      }
      return result.length > 0;
    },
  };
  return storage;
}
