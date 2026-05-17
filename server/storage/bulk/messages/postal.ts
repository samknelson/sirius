import { createNoopValidator } from '../../utils/validation';
import { getClient } from '../../transaction-context';
import { bulkMessagesPostal, type BulkMessagesPostal, type InsertBulkMessagesPostal } from "../../../../shared/schema/bulk/schema";
import { eq } from "drizzle-orm";
import { defineLoggingConfig } from "../../middleware/logging";

export const validate = createNoopValidator<InsertBulkMessagesPostal, BulkMessagesPostal>();

export interface BulkMessagesPostalStorage {
  getById(id: string): Promise<BulkMessagesPostal | undefined>;
  getByBulkId(bulkId: string): Promise<BulkMessagesPostal | undefined>;
  create(data: InsertBulkMessagesPostal): Promise<BulkMessagesPostal>;
  update(id: string, data: Partial<InsertBulkMessagesPostal>): Promise<BulkMessagesPostal | undefined>;
  delete(id: string): Promise<boolean>;
}

export function createBulkMessagesPostalStorage(): BulkMessagesPostalStorage {
  const storage: BulkMessagesPostalStorage = {
    async getById(id: string): Promise<BulkMessagesPostal | undefined> {
      const client = getClient();
      const [row] = await client
        .select()
        .from(bulkMessagesPostal)
        .where(eq(bulkMessagesPostal.id, id));
      return row || undefined;
    },

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

export const bulkMessagesPostalLoggingConfig = defineLoggingConfig<BulkMessagesPostalStorage>({
  module: 'bulkMessagesPostal',
  state: { key: 'bulkMessagesPostal' },
  getter: 'getById',
  hostEntityIdField: 'bulkId',
  methods: {
    create: {
      state: { fallbackId: 'new bulk postal' },
      metadata: (_args, result) => ({ bulkId: result?.bulkId }),
      getDescription: async () => `Created bulk postal message content`,
    },
    update: {
      before: async () => undefined,
      metadata: (_args, result) => ({ bulkId: result?.bulkId }),
      getDescription: async () => `Updated bulk postal message content`,
    },
    delete: {
      before: async (args, storage) => ({ record: await storage.getById(args[0]) }),
      getHostEntityId: (_args, _result, beforeState) => beforeState?.record?.bulkId,
      after: async (_args, result, _storage, beforeState) => ({
        deleted: result,
        metadata: { bulkId: beforeState?.record?.bulkId },
      }),
      getDescription: async () => `Deleted bulk postal message content`,
    },
  },
});
