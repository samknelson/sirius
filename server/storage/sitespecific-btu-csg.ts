import { getClient } from './transaction-context';
import { eq, desc } from "drizzle-orm";
import { tableExists as tableExistsUtil } from "./utils";
import { 
  sitespecificBtuCsg,
  type BtuCsgRecord, 
  type InsertBtuCsgRecord 
} from "../../shared/schema/sitespecific/btu/schema";
import { getTableName } from "drizzle-orm";
import type { StorageLoggingConfig } from "./middleware/logging";

export type { BtuCsgRecord, InsertBtuCsgRecord };

export interface BtuCsgStorage {
  getAll(): Promise<BtuCsgRecord[]>;
  get(id: string): Promise<BtuCsgRecord | undefined>;
  create(record: InsertBtuCsgRecord): Promise<BtuCsgRecord>;
  update(id: string, record: Partial<InsertBtuCsgRecord>): Promise<BtuCsgRecord | undefined>;
  delete(id: string): Promise<boolean>;
  tableExists(): Promise<boolean>;
}

const tableName = getTableName(sitespecificBtuCsg);

export function createBtuCsgStorage(): BtuCsgStorage {
  return {
    async tableExists(): Promise<boolean> {
      return tableExistsUtil(tableName);
    },

    async getAll(): Promise<BtuCsgRecord[]> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      const client = getClient();
      return client
        .select()
        .from(sitespecificBtuCsg)
        .orderBy(desc(sitespecificBtuCsg.createdAt));
    },

    async get(id: string): Promise<BtuCsgRecord | undefined> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      const client = getClient();
      const results = await client
        .select()
        .from(sitespecificBtuCsg)
        .where(eq(sitespecificBtuCsg.id, id));
      return results[0];
    },

    async create(record: InsertBtuCsgRecord): Promise<BtuCsgRecord> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      const client = getClient();
      const results = await client
        .insert(sitespecificBtuCsg)
        .values(record)
        .returning();
      return results[0];
    },

    async update(id: string, record: Partial<InsertBtuCsgRecord>): Promise<BtuCsgRecord | undefined> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      const client = getClient();
      const results = await client
        .update(sitespecificBtuCsg)
        .set(record)
        .where(eq(sitespecificBtuCsg.id, id))
        .returning();
      return results[0];
    },

    async delete(id: string): Promise<boolean> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      const client = getClient();
      const results = await client
        .delete(sitespecificBtuCsg)
        .where(eq(sitespecificBtuCsg.id, id))
        .returning({ id: sitespecificBtuCsg.id });
      return results.length > 0;
    },
  };
}

export const btuCsgLoggingConfig: StorageLoggingConfig<BtuCsgStorage> = {
  module: 'btu-csg',
  methods: {
    create: {
      enabled: true,
      getEntityId: (args, result) => result?.id || 'new record',
      getDescription: async (args, result) => {
        const firstName = result?.firstName || args[0]?.firstName || '';
        const lastName = result?.lastName || args[0]?.lastName || '';
        const name = `${firstName} ${lastName}`.trim() || 'Unknown';
        return `Created BTU CSG record for ${name}`;
      },
      after: async (args, result) => {
        return {
          record: result,
          metadata: {
            id: result?.id,
            bpsId: result?.bpsId,
            firstName: result?.firstName,
            lastName: result?.lastName,
            status: result?.status,
          }
        };
      }
    },
    update: {
      enabled: true,
      getEntityId: (args) => args[0],
      getDescription: async (args, result, beforeState) => {
        const firstName = result?.firstName || beforeState?.record?.firstName || '';
        const lastName = result?.lastName || beforeState?.record?.lastName || '';
        const name = `${firstName} ${lastName}`.trim() || 'Unknown';
        return `Updated BTU CSG record for ${name}`;
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
            bpsId: result?.bpsId,
            firstName: result?.firstName,
            lastName: result?.lastName,
            status: result?.status,
          }
        };
      }
    },
    delete: {
      enabled: true,
      getEntityId: (args) => args[0],
      getDescription: async (args, result, beforeState) => {
        const firstName = beforeState?.record?.firstName || '';
        const lastName = beforeState?.record?.lastName || '';
        const name = `${firstName} ${lastName}`.trim() || 'Unknown';
        return `Deleted BTU CSG record for ${name}`;
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
            bpsId: beforeState?.record?.bpsId,
          }
        };
      }
    },
  },
};
