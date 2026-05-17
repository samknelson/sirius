import { createNoopValidator } from '../../utils/validation';
import { getClient } from '../../transaction-context';
import { bulkMessagesInapp, type BulkMessagesInapp, type InsertBulkMessagesInapp } from "../../../../shared/schema/bulk/schema";
import { eq } from "drizzle-orm";
import { defineLoggingConfig } from "../../middleware/logging";

export const validate = createNoopValidator<InsertBulkMessagesInapp, BulkMessagesInapp>();

export interface BulkMessagesInappStorage {
  getById(id: string): Promise<BulkMessagesInapp | undefined>;
  getByBulkId(bulkId: string): Promise<BulkMessagesInapp | undefined>;
  create(data: InsertBulkMessagesInapp): Promise<BulkMessagesInapp>;
  update(id: string, data: Partial<InsertBulkMessagesInapp>): Promise<BulkMessagesInapp | undefined>;
  delete(id: string): Promise<boolean>;
}

export function createBulkMessagesInappStorage(): BulkMessagesInappStorage {
  const storage: BulkMessagesInappStorage = {
    async getById(id: string): Promise<BulkMessagesInapp | undefined> {
      const client = getClient();
      const [row] = await client
        .select()
        .from(bulkMessagesInapp)
        .where(eq(bulkMessagesInapp.id, id));
      return row || undefined;
    },

    async getByBulkId(bulkId: string): Promise<BulkMessagesInapp | undefined> {
      const client = getClient();
      const [row] = await client
        .select()
        .from(bulkMessagesInapp)
        .where(eq(bulkMessagesInapp.bulkId, bulkId));
      return row || undefined;
    },

    async create(data: InsertBulkMessagesInapp): Promise<BulkMessagesInapp> {
      validate.validateOrThrow(data);
      const client = getClient();
      const [row] = await client
        .insert(bulkMessagesInapp)
        .values(data)
        .returning();
      return row;
    },

    async update(id: string, data: Partial<InsertBulkMessagesInapp>): Promise<BulkMessagesInapp | undefined> {
      const client = getClient();
      const [updated] = await client
        .update(bulkMessagesInapp)
        .set(data)
        .where(eq(bulkMessagesInapp.id, id))
        .returning();
      return updated || undefined;
    },

    async delete(id: string): Promise<boolean> {
      const client = getClient();
      const result = await client
        .delete(bulkMessagesInapp)
        .where(eq(bulkMessagesInapp.id, id))
        .returning();
      return result.length > 0;
    },
  };

  return storage;
}

export const bulkMessagesInappLoggingConfig = defineLoggingConfig<BulkMessagesInappStorage>({
  module: 'bulkMessagesInapp',
  stateKey: 'bulkMessagesInapp',
  getter: 'getById',
  hostEntityIdField: 'bulkId',
  methods: {
    create: {
      entityIdFallback: 'new bulk inapp',
      metadata: (_args, result) => ({ bulkId: result?.bulkId, title: result?.title }),
      getDescription: async () => `Created bulk in-app message content`,
    },
    update: {
      before: async () => undefined,
      metadata: (_args, result) => ({ bulkId: result?.bulkId, title: result?.title }),
      getDescription: async () => `Updated bulk in-app message content`,
    },
    delete: {
      before: async (args, storage) => ({ record: await storage.getById(args[0]) }),
      getHostEntityId: (_args, _result, beforeState) => beforeState?.record?.bulkId,
      after: async (_args, result, _storage, beforeState) => ({
        deleted: result,
        metadata: { bulkId: beforeState?.record?.bulkId },
      }),
      getDescription: async () => `Deleted bulk in-app message content`,
    },
  },
});
