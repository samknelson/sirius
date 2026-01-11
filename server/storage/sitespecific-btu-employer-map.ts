import { db } from './db';
import { eq, desc, ilike, or, and, SQL } from "drizzle-orm";
import { tableExists as tableExistsUtil } from "./utils";
import { 
  sitespecificBtuEmployerMap,
  type BtuEmployerMap, 
  type InsertBtuEmployerMap 
} from "../../shared/schema/sitespecific/btu/schema";
import { getTableName } from "drizzle-orm";
import type { StorageLoggingConfig } from "./middleware/logging";

export type { BtuEmployerMap, InsertBtuEmployerMap };

export interface BtuEmployerMapFilters {
  search?: string;
  departmentId?: string;
  locationId?: string;
  employerName?: string;
}

export interface BtuEmployerMapStorage {
  getAll(filters?: BtuEmployerMapFilters): Promise<BtuEmployerMap[]>;
  get(id: string): Promise<BtuEmployerMap | undefined>;
  create(record: InsertBtuEmployerMap): Promise<BtuEmployerMap>;
  update(id: string, record: Partial<InsertBtuEmployerMap>): Promise<BtuEmployerMap | undefined>;
  delete(id: string): Promise<boolean>;
  tableExists(): Promise<boolean>;
  getUniqueDepartments(): Promise<string[]>;
  getUniqueLocations(): Promise<string[]>;
  getUniqueEmployerNames(): Promise<string[]>;
}

const tableName = getTableName(sitespecificBtuEmployerMap);

export function createBtuEmployerMapStorage(): BtuEmployerMapStorage {
  return {
    async tableExists(): Promise<boolean> {
      return tableExistsUtil(tableName);
    },

    async getAll(filters?: BtuEmployerMapFilters): Promise<BtuEmployerMap[]> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }

      const conditions: SQL[] = [];

      if (filters?.search) {
        const searchPattern = `%${filters.search}%`;
        conditions.push(
          or(
            ilike(sitespecificBtuEmployerMap.departmentTitle, searchPattern),
            ilike(sitespecificBtuEmployerMap.locationTitle, searchPattern),
            ilike(sitespecificBtuEmployerMap.jobTitle, searchPattern),
            ilike(sitespecificBtuEmployerMap.jobCode, searchPattern),
            ilike(sitespecificBtuEmployerMap.employerName, searchPattern)
          )!
        );
      }

      if (filters?.departmentId && filters.departmentId !== "all") {
        conditions.push(eq(sitespecificBtuEmployerMap.departmentId, filters.departmentId));
      }

      if (filters?.locationId && filters.locationId !== "all") {
        conditions.push(eq(sitespecificBtuEmployerMap.locationId, filters.locationId));
      }

      if (filters?.employerName && filters.employerName !== "all") {
        conditions.push(eq(sitespecificBtuEmployerMap.employerName, filters.employerName));
      }

      if (conditions.length > 0) {
        return db
          .select()
          .from(sitespecificBtuEmployerMap)
          .where(and(...conditions))
          .orderBy(
            sitespecificBtuEmployerMap.departmentTitle,
            sitespecificBtuEmployerMap.locationTitle,
            sitespecificBtuEmployerMap.jobTitle
          );
      }

      return db
        .select()
        .from(sitespecificBtuEmployerMap)
        .orderBy(
          sitespecificBtuEmployerMap.departmentTitle,
          sitespecificBtuEmployerMap.locationTitle,
          sitespecificBtuEmployerMap.jobTitle
        );
    },

    async get(id: string): Promise<BtuEmployerMap | undefined> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      const results = await db
        .select()
        .from(sitespecificBtuEmployerMap)
        .where(eq(sitespecificBtuEmployerMap.id, id));
      return results[0];
    },

    async create(record: InsertBtuEmployerMap): Promise<BtuEmployerMap> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      const results = await db
        .insert(sitespecificBtuEmployerMap)
        .values(record)
        .returning();
      return results[0];
    },

    async update(id: string, record: Partial<InsertBtuEmployerMap>): Promise<BtuEmployerMap | undefined> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      const results = await db
        .update(sitespecificBtuEmployerMap)
        .set(record)
        .where(eq(sitespecificBtuEmployerMap.id, id))
        .returning();
      return results[0];
    },

    async delete(id: string): Promise<boolean> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      const results = await db
        .delete(sitespecificBtuEmployerMap)
        .where(eq(sitespecificBtuEmployerMap.id, id))
        .returning({ id: sitespecificBtuEmployerMap.id });
      return results.length > 0;
    },

    async getUniqueDepartments(): Promise<string[]> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      const results = await db
        .selectDistinct({ departmentId: sitespecificBtuEmployerMap.departmentId, departmentTitle: sitespecificBtuEmployerMap.departmentTitle })
        .from(sitespecificBtuEmployerMap)
        .orderBy(sitespecificBtuEmployerMap.departmentTitle);
      return results
        .filter(r => r.departmentId)
        .map(r => JSON.stringify({ id: r.departmentId, title: r.departmentTitle }));
    },

    async getUniqueLocations(): Promise<string[]> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      const results = await db
        .selectDistinct({ locationId: sitespecificBtuEmployerMap.locationId, locationTitle: sitespecificBtuEmployerMap.locationTitle })
        .from(sitespecificBtuEmployerMap)
        .orderBy(sitespecificBtuEmployerMap.locationTitle);
      return results
        .filter(r => r.locationId)
        .map(r => JSON.stringify({ id: r.locationId, title: r.locationTitle }));
    },

    async getUniqueEmployerNames(): Promise<string[]> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      const results = await db
        .selectDistinct({ employerName: sitespecificBtuEmployerMap.employerName })
        .from(sitespecificBtuEmployerMap)
        .orderBy(sitespecificBtuEmployerMap.employerName);
      return results
        .filter(r => r.employerName)
        .map(r => r.employerName!);
    },
  };
}

export const btuEmployerMapLoggingConfig: StorageLoggingConfig<BtuEmployerMapStorage> = {
  module: 'btu-employer-map',
  methods: {
    create: {
      enabled: true,
      getEntityId: (args, result) => result?.id || 'new record',
      getDescription: async (args, result) => {
        const dept = result?.departmentTitle || '';
        const loc = result?.locationTitle || '';
        const job = result?.jobTitle || '';
        return `Created employer map: ${dept} / ${loc} / ${job}`;
      },
      after: async (args, result) => {
        return {
          record: result,
          metadata: {
            id: result?.id,
            departmentId: result?.departmentId,
            locationId: result?.locationId,
            employerName: result?.employerName,
          }
        };
      }
    },
    update: {
      enabled: true,
      getEntityId: (args) => args[0],
      getDescription: async (args, result, beforeState) => {
        const dept = result?.departmentTitle || beforeState?.record?.departmentTitle || '';
        const loc = result?.locationTitle || beforeState?.record?.locationTitle || '';
        return `Updated employer map: ${dept} / ${loc}`;
      },
      before: async (args, storage) => {
        const record = await storage.get(args[0]);
        return { record };
      },
      after: async (args, result, _storage, beforeState) => {
        return {
          record: result,
          previousRecord: beforeState?.record,
          metadata: {
            id: result?.id,
            departmentId: result?.departmentId,
            locationId: result?.locationId,
            employerName: result?.employerName,
          }
        };
      }
    },
    delete: {
      enabled: true,
      getEntityId: (args) => args[0],
      getDescription: async (args, result, beforeState) => {
        const dept = beforeState?.record?.departmentTitle || '';
        const loc = beforeState?.record?.locationTitle || '';
        return `Deleted employer map: ${dept} / ${loc}`;
      },
      before: async (args, storage) => {
        const record = await storage.get(args[0]);
        return { record };
      },
      after: async (args, result, _storage, beforeState) => {
        return {
          deletedRecord: beforeState?.record,
          success: result,
          metadata: {
            id: beforeState?.record?.id,
            departmentId: beforeState?.record?.departmentId,
          }
        };
      }
    },
  },
};
