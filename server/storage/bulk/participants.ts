import { createNoopValidator } from '../utils/validation';
import { getClient } from '../transaction-context';
import { bulkParticipants, type BulkParticipant, type InsertBulkParticipant } from "../../../shared/schema/bulk/schema";
import { eq } from "drizzle-orm";
import type { StorageLoggingConfig } from "../middleware/logging";

export const validate = createNoopValidator<InsertBulkParticipant, BulkParticipant>();

export interface BulkParticipantStorage {
  getById(id: string): Promise<BulkParticipant | undefined>;
  getByMessageId(messageId: string): Promise<BulkParticipant[]>;
  create(data: InsertBulkParticipant): Promise<BulkParticipant>;
  update(id: string, data: Partial<InsertBulkParticipant>): Promise<BulkParticipant | undefined>;
  delete(id: string): Promise<boolean>;
}

export function createBulkParticipantStorage(): BulkParticipantStorage {
  const storage: BulkParticipantStorage = {
    async getById(id: string): Promise<BulkParticipant | undefined> {
      const client = getClient();
      const [row] = await client
        .select()
        .from(bulkParticipants)
        .where(eq(bulkParticipants.id, id));
      return row || undefined;
    },

    async getByMessageId(messageId: string): Promise<BulkParticipant[]> {
      const client = getClient();
      return await client
        .select()
        .from(bulkParticipants)
        .where(eq(bulkParticipants.messageId, messageId));
    },

    async create(data: InsertBulkParticipant): Promise<BulkParticipant> {
      validate.validateOrThrow(data);
      const client = getClient();
      const [row] = await client
        .insert(bulkParticipants)
        .values(data)
        .returning();
      return row;
    },

    async update(id: string, data: Partial<InsertBulkParticipant>): Promise<BulkParticipant | undefined> {
      const client = getClient();
      const [updated] = await client
        .update(bulkParticipants)
        .set(data)
        .where(eq(bulkParticipants.id, id))
        .returning();
      return updated || undefined;
    },

    async delete(id: string): Promise<boolean> {
      const client = getClient();
      const result = await client
        .delete(bulkParticipants)
        .where(eq(bulkParticipants.id, id))
        .returning();
      return result.length > 0;
    },
  };

  return storage;
}

export const bulkParticipantLoggingConfig: StorageLoggingConfig<BulkParticipantStorage> = {
  module: 'bulkParticipants',
  methods: {
    create: {
      enabled: true,
      getEntityId: (args, result) => result?.id || 'new bulk participant',
      getHostEntityId: (args, result) => result?.messageId,
      getDescription: async (args, result) => {
        return `Added participant (contact ${result?.contactId}) to bulk message ${result?.messageId}`;
      },
      after: async (args, result) => {
        return {
          bulkParticipant: result,
          metadata: {
            messageId: result?.messageId,
            contactId: result?.contactId,
            commId: result?.commId,
          }
        };
      }
    },
    update: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: (args, result) => result?.messageId,
      getDescription: async () => `Updated bulk participant`,
      after: async (args, result) => {
        return {
          bulkParticipant: result,
          metadata: {
            messageId: result?.messageId,
            contactId: result?.contactId,
            commId: result?.commId,
          }
        };
      }
    },
    delete: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: (_args, _result, beforeState) => beforeState?.record?.messageId,
      getDescription: async () => `Deleted bulk participant`,
      before: async (args, storage) => {
        const record = await storage.getById(args[0]);
        return { record };
      },
      after: async (args, result, _storage, beforeState) => {
        return { deleted: result, metadata: { messageId: beforeState?.record?.messageId } };
      }
    },
  }
};
