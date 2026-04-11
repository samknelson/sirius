import { createNoopValidator } from '../utils/validation';
import { getClient } from '../transaction-context';
import { bulkMessages, type BulkMessage, type InsertBulkMessage } from "../../../shared/schema/bulk/schema";
import { eq, and, ilike, type SQL } from "drizzle-orm";
import type { StorageLoggingConfig } from "../middleware/logging";

export const validate = createNoopValidator<InsertBulkMessage, BulkMessage>();

export interface BulkMessageStorage {
  getAll(filters?: { status?: string; medium?: string; name?: string }): Promise<BulkMessage[]>;
  getById(id: string): Promise<BulkMessage | undefined>;
  create(data: InsertBulkMessage): Promise<BulkMessage>;
  update(id: string, data: Partial<InsertBulkMessage>): Promise<BulkMessage | undefined>;
  delete(id: string): Promise<boolean>;
}

export function createBulkMessageStorage(): BulkMessageStorage {
  const storage: BulkMessageStorage = {
    async getAll(filters?: { status?: string; medium?: string; name?: string }): Promise<BulkMessage[]> {
      const client = getClient();
      const conditions: SQL[] = [];
      if (filters?.status) {
        conditions.push(eq(bulkMessages.status, filters.status as "draft" | "queued" | "sent"));
      }
      if (filters?.medium) {
        conditions.push(eq(bulkMessages.medium, filters.medium as "sms" | "email" | "inapp" | "postal"));
      }
      if (filters?.name) {
        conditions.push(ilike(bulkMessages.name, `%${filters.name}%`));
      }
      if (conditions.length > 0) {
        return await client.select().from(bulkMessages).where(and(...conditions));
      }
      return await client.select().from(bulkMessages);
    },

    async getById(id: string): Promise<BulkMessage | undefined> {
      const client = getClient();
      const [row] = await client
        .select()
        .from(bulkMessages)
        .where(eq(bulkMessages.id, id));
      return row || undefined;
    },

    async create(data: InsertBulkMessage): Promise<BulkMessage> {
      validate.validateOrThrow(data);
      const client = getClient();
      const [row] = await client
        .insert(bulkMessages)
        .values(data)
        .returning();
      return row;
    },

    async update(id: string, data: Partial<InsertBulkMessage>): Promise<BulkMessage | undefined> {
      const client = getClient();
      const [updated] = await client
        .update(bulkMessages)
        .set(data)
        .where(eq(bulkMessages.id, id))
        .returning();
      return updated || undefined;
    },

    async delete(id: string): Promise<boolean> {
      const client = getClient();
      const result = await client
        .delete(bulkMessages)
        .where(eq(bulkMessages.id, id))
        .returning();
      return result.length > 0;
    },
  };

  return storage;
}

export const bulkMessageLoggingConfig: StorageLoggingConfig<BulkMessageStorage> = {
  module: 'bulkMessages',
  methods: {
    create: {
      enabled: true,
      getEntityId: (args, result) => result?.id || 'new bulk message',
      getHostEntityId: (args, result) => result?.id,
      getDescription: async (args, result) => {
        const name = result?.name || args[0]?.name || 'Unnamed';
        return `Created bulk message "${name}"`;
      },
      after: async (args, result) => {
        return {
          bulkMessage: result,
          metadata: {
            bulkMessageId: result?.id,
            name: result?.name,
            medium: result?.medium,
            status: result?.status,
          }
        };
      }
    },
    update: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: (args) => args[0],
      getDescription: async (args, result, beforeState) => {
        const oldName = beforeState?.bulkMessage?.name || 'Unknown';
        const newName = result?.name || oldName;
        if (oldName !== newName) {
          return `Updated bulk message "${oldName}" → "${newName}"`;
        }
        return `Updated bulk message "${newName}"`;
      },
      before: async (args, storage) => {
        const bulkMessage = await storage.getById(args[0]);
        return { bulkMessage };
      },
      after: async (args, result, _storage, beforeState) => {
        return {
          bulkMessage: result,
          previousBulkMessage: beforeState?.bulkMessage,
          metadata: {
            bulkMessageId: result?.id,
            name: result?.name,
            medium: result?.medium,
            status: result?.status,
          }
        };
      }
    },
    delete: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: (args) => args[0],
      getDescription: async (args, result, beforeState) => {
        const name = beforeState?.bulkMessage?.name || 'Unknown';
        return `Deleted bulk message "${name}"`;
      },
      before: async (args, storage) => {
        const bulkMessage = await storage.getById(args[0]);
        return { bulkMessage };
      },
      after: async (args, result, _storage, beforeState) => {
        return {
          deleted: result,
          bulkMessage: beforeState?.bulkMessage,
          metadata: {
            bulkMessageId: args[0],
            name: beforeState?.bulkMessage?.name,
          }
        };
      }
    },
  }
};
