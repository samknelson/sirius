import { createNoopValidator } from '../utils/validation';
import { getClient } from '../transaction-context';
import {
  dispatchJobGroups,
  type DispatchJobGroup,
  type InsertDispatchJobGroup
} from "@shared/schema";
import { eq, desc, sql, SQL, and, ilike } from "drizzle-orm";
import { type StorageLoggingConfig } from "../middleware/logging";

export const validate = createNoopValidator<InsertDispatchJobGroup, DispatchJobGroup>();

export interface DispatchJobGroupFilters {
  search?: string;
  active?: 'active' | 'inactive' | 'all';
}

export interface PaginatedDispatchJobGroups {
  data: DispatchJobGroup[];
  total: number;
  page: number;
  limit: number;
}

export interface DispatchJobGroupStorage {
  getAll(): Promise<DispatchJobGroup[]>;
  getPaginated(page: number, limit: number, filters?: DispatchJobGroupFilters): Promise<PaginatedDispatchJobGroups>;
  get(id: string): Promise<DispatchJobGroup | undefined>;
  getBySiriusId(siriusId: string): Promise<DispatchJobGroup | undefined>;
  getByName(name: string): Promise<DispatchJobGroup | undefined>;
  create(group: InsertDispatchJobGroup): Promise<DispatchJobGroup>;
  update(id: string, group: Partial<InsertDispatchJobGroup>): Promise<DispatchJobGroup | undefined>;
  delete(id: string): Promise<boolean>;
}

export const dispatchJobGroupLoggingConfig: StorageLoggingConfig<DispatchJobGroupStorage> = {
  module: 'dispatchJobGroups',
  methods: {
    create: {
      enabled: true,
      getEntityId: (args, result) => result?.id || 'new dispatch job group',
      getHostEntityId: (args, result) => result?.id,
      getDescription: async (args, result) => {
        const name = result?.name || args[0]?.name || 'Unnamed';
        return `Created Dispatch Job Group "${name}"`;
      },
      after: async (args, result) => ({
        group: result,
        metadata: { groupId: result?.id, name: result?.name }
      })
    },
    update: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: (args) => args[0],
      getDescription: async (args, result, beforeState) => {
        const name = result?.name || beforeState?.group?.name || 'Unknown';
        return `Updated Dispatch Job Group "${name}"`;
      },
      before: async (args, storage) => {
        const group = await storage.get(args[0]);
        return group ? { group } : null;
      },
      after: async (args, result, storage, beforeState) => ({
        group: result,
        previousState: beforeState?.group,
        metadata: { groupId: result?.id, name: result?.name }
      })
    },
    delete: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: (args) => args[0],
      getDescription: async (args, result, beforeState) => {
        const name = beforeState?.group?.name || 'Unknown';
        return `Deleted Dispatch Job Group "${name}"`;
      },
      before: async (args, storage) => {
        const group = await storage.get(args[0]);
        return group ? { group } : null;
      }
    }
  }
};

export function createDispatchJobGroupStorage(): DispatchJobGroupStorage {
  return {
    async getAll(): Promise<DispatchJobGroup[]> {
      const client = getClient();
      return client.select().from(dispatchJobGroups).orderBy(desc(dispatchJobGroups.startYmd));
    },

    async getPaginated(page: number, limit: number, filters?: DispatchJobGroupFilters): Promise<PaginatedDispatchJobGroups> {
      const client = getClient();
      const conditions: SQL[] = [];

      if (filters?.search) {
        conditions.push(ilike(dispatchJobGroups.name, `%${filters.search}%`));
      }

      if (filters?.active === 'active') {
        const today = new Date().toISOString().slice(0, 10);
        conditions.push(sql`${dispatchJobGroups.startYmd} <= ${today}`);
        conditions.push(sql`${dispatchJobGroups.endYmd} >= ${today}`);
      } else if (filters?.active === 'inactive') {
        const today = new Date().toISOString().slice(0, 10);
        conditions.push(sql`(${dispatchJobGroups.startYmd} > ${today} OR ${dispatchJobGroups.endYmd} < ${today})`);
      }

      const hasFilters = conditions.length > 0;
      const whereClause = hasFilters ? and(...conditions) : undefined;

      const countQuery = client
        .select({ count: sql<number>`count(*)::int` })
        .from(dispatchJobGroups);

      const [countResult] = hasFilters
        ? await countQuery.where(whereClause!)
        : await countQuery;

      const total = countResult?.count || 0;

      const baseQuery = client
        .select()
        .from(dispatchJobGroups);

      const data = hasFilters
        ? await baseQuery.where(whereClause!).orderBy(desc(dispatchJobGroups.startYmd)).limit(limit).offset(page * limit)
        : await baseQuery.orderBy(desc(dispatchJobGroups.startYmd)).limit(limit).offset(page * limit);

      return { data, total, page, limit };
    },

    async get(id: string): Promise<DispatchJobGroup | undefined> {
      const client = getClient();
      const [group] = await client.select().from(dispatchJobGroups).where(eq(dispatchJobGroups.id, id));
      return group || undefined;
    },

    async getBySiriusId(siriusId: string): Promise<DispatchJobGroup | undefined> {
      const client = getClient();
      const [group] = await client.select().from(dispatchJobGroups).where(eq(dispatchJobGroups.siriusId, siriusId));
      return group || undefined;
    },

    async getByName(name: string): Promise<DispatchJobGroup | undefined> {
      const client = getClient();
      const [group] = await client.select().from(dispatchJobGroups).where(ilike(dispatchJobGroups.name, name));
      return group || undefined;
    },

    async create(insertGroup: InsertDispatchJobGroup): Promise<DispatchJobGroup> {
      validate.validateOrThrow(insertGroup);
      const client = getClient();
      const [group] = await client.insert(dispatchJobGroups).values(insertGroup).returning();
      return group;
    },

    async update(id: string, groupUpdate: Partial<InsertDispatchJobGroup>): Promise<DispatchJobGroup | undefined> {
      const client = getClient();
      const [existing] = await client.select().from(dispatchJobGroups).where(eq(dispatchJobGroups.id, id));
      if (!existing) return undefined;

      const [group] = await client
        .update(dispatchJobGroups)
        .set(groupUpdate)
        .where(eq(dispatchJobGroups.id, id))
        .returning();
      return group || undefined;
    },

    async delete(id: string): Promise<boolean> {
      const client = getClient();
      const result = await client.delete(dispatchJobGroups).where(eq(dispatchJobGroups.id, id)).returning();
      return result.length > 0;
    }
  };
}
