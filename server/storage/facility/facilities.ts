import { createNoopValidator } from '../utils/validation';
import { getClient } from '../transaction-context';
import {
  facilities,
  type Facility,
  type InsertFacility,
} from "@shared/schema";
import { eq, asc, desc, sql, SQL, and, ilike } from "drizzle-orm";
import { type StorageLoggingConfig } from "../middleware/logging";

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

export interface FacilityStorage {
  getAll(): Promise<Facility[]>;
  getPaginated(page: number, limit: number, filters?: FacilityFilters): Promise<PaginatedFacilities>;
  get(id: string): Promise<Facility | undefined>;
  getBySiriusId(siriusId: string): Promise<Facility | undefined>;
  create(facility: InsertFacility): Promise<Facility>;
  update(id: string, facility: Partial<InsertFacility>): Promise<Facility | undefined>;
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

export function createFacilityStorage(): FacilityStorage {
  return {
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

    async getBySiriusId(siriusId: string): Promise<Facility | undefined> {
      const client = getClient();
      const [facility] = await client.select().from(facilities).where(eq(facilities.siriusId, siriusId));
      return facility || undefined;
    },

    async create(insertFacility: InsertFacility): Promise<Facility> {
      validate.validateOrThrow(insertFacility);
      const client = getClient();
      const [facility] = await client.insert(facilities).values(insertFacility).returning();
      return facility;
    },

    async update(id: string, facilityUpdate: Partial<InsertFacility>): Promise<Facility | undefined> {
      const client = getClient();
      const [existing] = await client.select().from(facilities).where(eq(facilities.id, id));
      if (!existing) return undefined;

      const [facility] = await client
        .update(facilities)
        .set(facilityUpdate)
        .where(eq(facilities.id, id))
        .returning();
      return facility || undefined;
    },

    async delete(id: string): Promise<boolean> {
      const client = getClient();
      const result = await client.delete(facilities).where(eq(facilities.id, id)).returning();
      return result.length > 0;
    },
  };
}
