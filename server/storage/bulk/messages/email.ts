import { createNoopValidator } from '../../utils/validation';
import { getClient } from '../../transaction-context';
import { bulkMessagesEmail, type BulkMessagesEmail, type InsertBulkMessagesEmail } from "../../../../shared/schema/bulk/schema";
import { eq } from "drizzle-orm";
import type { StorageLoggingConfig } from "../../middleware/logging";

export const validate = createNoopValidator<InsertBulkMessagesEmail, BulkMessagesEmail>();

export interface BulkMessagesEmailStorage {
  getById(id: string): Promise<BulkMessagesEmail | undefined>;
  getByBulkId(bulkId: string): Promise<BulkMessagesEmail | undefined>;
  create(data: InsertBulkMessagesEmail): Promise<BulkMessagesEmail>;
  update(id: string, data: Partial<InsertBulkMessagesEmail>): Promise<BulkMessagesEmail | undefined>;
  delete(id: string): Promise<boolean>;
}

export function createBulkMessagesEmailStorage(): BulkMessagesEmailStorage {
  const storage: BulkMessagesEmailStorage = {
    async getById(id: string): Promise<BulkMessagesEmail | undefined> {
      const client = getClient();
      const [row] = await client
        .select()
        .from(bulkMessagesEmail)
        .where(eq(bulkMessagesEmail.id, id));
      return row || undefined;
    },

    async getByBulkId(bulkId: string): Promise<BulkMessagesEmail | undefined> {
      const client = getClient();
      const [row] = await client
        .select()
        .from(bulkMessagesEmail)
        .where(eq(bulkMessagesEmail.bulkId, bulkId));
      return row || undefined;
    },

    async create(data: InsertBulkMessagesEmail): Promise<BulkMessagesEmail> {
      validate.validateOrThrow(data);
      const client = getClient();
      const [row] = await client
        .insert(bulkMessagesEmail)
        .values(data)
        .returning();
      return row;
    },

    async update(id: string, data: Partial<InsertBulkMessagesEmail>): Promise<BulkMessagesEmail | undefined> {
      const client = getClient();
      const [updated] = await client
        .update(bulkMessagesEmail)
        .set(data)
        .where(eq(bulkMessagesEmail.id, id))
        .returning();
      return updated || undefined;
    },

    async delete(id: string): Promise<boolean> {
      const client = getClient();
      const result = await client
        .delete(bulkMessagesEmail)
        .where(eq(bulkMessagesEmail.id, id))
        .returning();
      return result.length > 0;
    },
  };

  return storage;
}

export const bulkMessagesEmailLoggingConfig: StorageLoggingConfig<BulkMessagesEmailStorage> = {
  module: 'bulkMessagesEmail',
  methods: {
    create: {
      enabled: true,
      getEntityId: (args, result) => result?.id || 'new bulk email',
      getHostEntityId: (args, result) => result?.bulkId,
      getDescription: async (args, result) => {
        return `Created bulk email message content`;
      },
      after: async (args, result) => {
        return {
          bulkMessagesEmail: result,
          metadata: { bulkId: result?.bulkId, subject: result?.subject }
        };
      }
    },
    update: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: (args, result) => result?.bulkId,
      getDescription: async () => `Updated bulk email message content`,
      before: async (args, storage) => {
        return {};
      },
      after: async (args, result) => {
        return {
          bulkMessagesEmail: result,
          metadata: { bulkId: result?.bulkId, subject: result?.subject }
        };
      }
    },
    delete: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: (_args, _result, beforeState) => beforeState?.record?.bulkId,
      getDescription: async () => `Deleted bulk email message content`,
      before: async (args, storage) => {
        const record = await storage.getById(args[0]);
        return { record };
      },
      after: async (args, result, _storage, beforeState) => {
        return { deleted: result, metadata: { bulkId: beforeState?.record?.bulkId } };
      }
    },
  }
};
