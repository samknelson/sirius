import { createNoopValidator } from './utils/validation';
import { getClient } from './transaction-context';
import { bulkMessagesSms, type BulkMessagesSms, type InsertBulkMessagesSms } from "../../shared/schema/bulk/schema";
import { eq } from "drizzle-orm";
import type { StorageLoggingConfig } from "./middleware/logging";

export const validate = createNoopValidator<InsertBulkMessagesSms, BulkMessagesSms>();

export interface BulkMessagesSmsStorage {
  getByBulkId(bulkId: string): Promise<BulkMessagesSms | undefined>;
  create(data: InsertBulkMessagesSms): Promise<BulkMessagesSms>;
  update(id: string, data: Partial<InsertBulkMessagesSms>): Promise<BulkMessagesSms | undefined>;
  delete(id: string): Promise<boolean>;
}

export function createBulkMessagesSmsStorage(): BulkMessagesSmsStorage {
  const storage: BulkMessagesSmsStorage = {
    async getByBulkId(bulkId: string): Promise<BulkMessagesSms | undefined> {
      const client = getClient();
      const [row] = await client
        .select()
        .from(bulkMessagesSms)
        .where(eq(bulkMessagesSms.bulkId, bulkId));
      return row || undefined;
    },

    async create(data: InsertBulkMessagesSms): Promise<BulkMessagesSms> {
      validate.validateOrThrow(data);
      const client = getClient();
      const [row] = await client
        .insert(bulkMessagesSms)
        .values(data)
        .returning();
      return row;
    },

    async update(id: string, data: Partial<InsertBulkMessagesSms>): Promise<BulkMessagesSms | undefined> {
      const client = getClient();
      const [updated] = await client
        .update(bulkMessagesSms)
        .set(data)
        .where(eq(bulkMessagesSms.id, id))
        .returning();
      return updated || undefined;
    },

    async delete(id: string): Promise<boolean> {
      const client = getClient();
      const result = await client
        .delete(bulkMessagesSms)
        .where(eq(bulkMessagesSms.id, id))
        .returning();
      return result.length > 0;
    },
  };

  return storage;
}

export const bulkMessagesSmsLoggingConfig: StorageLoggingConfig<BulkMessagesSmsStorage> = {
  module: 'bulkMessagesSms',
  methods: {
    create: {
      enabled: true,
      getEntityId: (args, result) => result?.id || 'new bulk sms',
      getHostEntityId: (args, result) => result?.bulkId,
      getDescription: async () => `Created bulk SMS message content`,
      after: async (args, result) => {
        return {
          bulkMessagesSms: result,
          metadata: { bulkId: result?.bulkId }
        };
      }
    },
    update: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: (args, result) => result?.bulkId,
      getDescription: async () => `Updated bulk SMS message content`,
      after: async (args, result) => {
        return {
          bulkMessagesSms: result,
          metadata: { bulkId: result?.bulkId }
        };
      }
    },
    delete: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: (args) => args[0],
      getDescription: async () => `Deleted bulk SMS message content`,
      after: async (args, result) => {
        return { deleted: result };
      }
    },
  }
};
