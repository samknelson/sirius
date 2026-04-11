import { createNoopValidator } from './utils/validation';
import { getClient } from './transaction-context';
import { bulkMessagesPostal, type BulkMessagesPostal, type InsertBulkMessagesPostal } from "../../shared/schema/bulk/schema";
import { eq } from "drizzle-orm";
import type { StorageLoggingConfig } from "./middleware/logging";

export const validate = createNoopValidator<InsertBulkMessagesPostal, BulkMessagesPostal>();

export interface BulkMessagesPostalStorage {
  getByBulkId(bulkId: string): Promise<BulkMessagesPostal | undefined>;
  create(data: InsertBulkMessagesPostal): Promise<BulkMessagesPostal>;
  update(id: string, data: Partial<InsertBulkMessagesPostal>): Promise<BulkMessagesPostal | undefined>;
  delete(id: string): Promise<boolean>;
}

export function createBulkMessagesPostalStorage(): BulkMessagesPostalStorage {
  const storage: BulkMessagesPostalStorage = {
    async getByBulkId(bulkId: string): Promise<BulkMessagesPostal | undefined> {
      const client = getClient();
      const [row] = await client
        .select()
        .from(bulkMessagesPostal)
        .where(eq(bulkMessagesPostal.bulkId, bulkId));
      return row || undefined;
    },

    async create(data: InsertBulkMessagesPostal): Promise<BulkMessagesPostal> {
      validate.validateOrThrow(data);
      const client = getClient();
      const [row] = await client
        .insert(bulkMessagesPostal)
        .values(data)
        .returning();
      return row;
    },

    async update(id: string, data: Partial<InsertBulkMessagesPostal>): Promise<BulkMessagesPostal | undefined> {
      const client = getClient();
      const [updated] = await client
        .update(bulkMessagesPostal)
        .set(data)
        .where(eq(bulkMessagesPostal.id, id))
        .returning();
      return updated || undefined;
    },

    async delete(id: string): Promise<boolean> {
      const client = getClient();
      const result = await client
        .delete(bulkMessagesPostal)
        .where(eq(bulkMessagesPostal.id, id))
        .returning();
      return result.length > 0;
    },
  };

  return storage;
}

export const bulkMessagesPostalLoggingConfig: StorageLoggingConfig<BulkMessagesPostalStorage> = {
  module: 'bulkMessagesPostal',
  methods: {
    create: {
      enabled: true,
      getEntityId: (args, result) => result?.id || 'new bulk postal',
      getHostEntityId: (args, result) => result?.bulkId,
      getDescription: async () => `Created bulk postal message content`,
      after: async (args, result) => {
        return {
          bulkMessagesPostal: result,
          metadata: { bulkId: result?.bulkId }
        };
      }
    },
    update: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: (args, result) => result?.bulkId,
      getDescription: async () => `Updated bulk postal message content`,
      after: async (args, result) => {
        return {
          bulkMessagesPostal: result,
          metadata: { bulkId: result?.bulkId }
        };
      }
    },
    delete: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: (args) => args[0],
      getDescription: async () => `Deleted bulk postal message content`,
      after: async (args, result) => {
        return { deleted: result };
      }
    },
  }
};
