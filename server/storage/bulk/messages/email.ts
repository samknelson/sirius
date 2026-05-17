import { createNoopValidator } from '../../utils/validation';
import { getClient } from '../../transaction-context';
import { bulkMessagesEmail, type BulkMessagesEmail, type InsertBulkMessagesEmail } from "../../../../shared/schema/bulk/schema";
import { eq } from "drizzle-orm";
import { defineLoggingConfig } from "../../middleware/logging";

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

export const bulkMessagesEmailLoggingConfig = defineLoggingConfig<BulkMessagesEmailStorage>({
  module: 'bulkMessagesEmail',
  stateKey: 'bulkMessagesEmail',
  getter: 'getById',
  hostEntityIdField: 'bulkId',
  methods: {
    create: {
      entityIdFallback: 'new bulk email',
      metadata: (_args, result) => ({ bulkId: result?.bulkId, subject: result?.subject }),
      getDescription: async () => `Created bulk email message content`,
    },
    update: {
      // Legacy quirk: empty before-state object (recorded as `details.before = {}`).
      before: async () => ({}),
      metadata: (_args, result) => ({ bulkId: result?.bulkId, subject: result?.subject }),
      getDescription: async () => `Updated bulk email message content`,
    },
    delete: {
      before: async (args, storage) => ({ record: await storage.getById(args[0]) }),
      getHostEntityId: (_args, _result, beforeState) => beforeState?.record?.bulkId,
      after: async (_args, result, _storage, beforeState) => ({
        deleted: result,
        metadata: { bulkId: beforeState?.record?.bulkId },
      }),
      getDescription: async () => `Deleted bulk email message content`,
    },
  },
});
