import { createNoopValidator } from '../../utils/validation';
import { getClient } from '../../transaction-context';
import { bulkMessagesSms, type BulkMessagesSms, type InsertBulkMessagesSms } from "../../../../shared/schema/bulk/schema";
import { eq } from "drizzle-orm";
import { defineLoggingConfig } from "../../middleware/logging";

export const validate = createNoopValidator<InsertBulkMessagesSms, BulkMessagesSms>();

export interface BulkMessagesSmsStorage {
  getById(id: string): Promise<BulkMessagesSms | undefined>;
  getByBulkId(bulkId: string): Promise<BulkMessagesSms | undefined>;
  create(data: InsertBulkMessagesSms): Promise<BulkMessagesSms>;
  update(id: string, data: Partial<InsertBulkMessagesSms>): Promise<BulkMessagesSms | undefined>;
  delete(id: string): Promise<boolean>;
}

export function createBulkMessagesSmsStorage(): BulkMessagesSmsStorage {
  const storage: BulkMessagesSmsStorage = {
    async getById(id: string): Promise<BulkMessagesSms | undefined> {
      const client = getClient();
      const [row] = await client
        .select()
        .from(bulkMessagesSms)
        .where(eq(bulkMessagesSms.id, id));
      return row || undefined;
    },

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

export const bulkMessagesSmsLoggingConfig = defineLoggingConfig<BulkMessagesSmsStorage>({
  module: 'bulkMessagesSms',
  stateKey: 'bulkMessagesSms',
  getter: 'getById',
  hostEntityIdField: 'bulkId',
  methods: {
    create: {
      entityIdFallback: 'new bulk sms',
      metadata: (_args, result) => ({ bulkId: result?.bulkId }),
      getDescription: async () => `Created bulk SMS message content`,
    },
    update: {
      // Preserve legacy shape (no before-state read on update).
      before: async () => undefined,
      metadata: (_args, result) => ({ bulkId: result?.bulkId }),
      getDescription: async () => `Updated bulk SMS message content`,
    },
    delete: {
      // Legacy used a `record` wrapper key; keep it intact.
      before: async (args, storage) => ({ record: await storage.getById(args[0]) }),
      getHostEntityId: (_args, _result, beforeState) => beforeState?.record?.bulkId,
      after: async (_args, result, _storage, beforeState) => ({
        deleted: result,
        metadata: { bulkId: beforeState?.record?.bulkId },
      }),
      getDescription: async () => `Deleted bulk SMS message content`,
    },
  },
});
