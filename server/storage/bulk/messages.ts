import { createNoopValidator } from '../utils/validation';
import { getClient } from '../transaction-context';
import { bulkMessages, type BulkMessage, type InsertBulkMessage } from "../../../shared/schema/bulk/schema";
import { eq, and, ilike, sql, type SQL } from "drizzle-orm";
import { defineLoggingConfig } from "../middleware/logging";

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
        conditions.push(sql`${filters.medium} = ANY(${bulkMessages.medium})`);
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

export const bulkMessageLoggingConfig = defineLoggingConfig<BulkMessageStorage>({
  module: 'bulkMessages',
  stateKey: 'bulkMessage',
  getter: 'getById',
  methods: {
    create: {
      entityIdFallback: 'new bulk message',
      getHostEntityId: (_args, result) => result?.id,
      metadata: (_args, result) => ({
        bulkMessageId: result?.id,
        name: result?.name,
        medium: result?.medium,
        status: result?.status,
      }),
      getDescription: async (args, result) => {
        const name = result?.name || args[0]?.name || 'Unnamed';
        return `Created bulk message "${name}"`;
      },
    },
    update: {
      getHostEntityId: (args) => args[0],
      previousStateKey: 'previousBulkMessage',
      metadata: (_args, result) => ({
        bulkMessageId: result?.id,
        name: result?.name,
        medium: result?.medium,
        status: result?.status,
      }),
      getDescription: async (_args, result, beforeState) => {
        const oldName = beforeState?.bulkMessage?.name || 'Unknown';
        const newName = result?.name || oldName;
        if (oldName !== newName) {
          return `Updated bulk message "${oldName}" → "${newName}"`;
        }
        return `Updated bulk message "${newName}"`;
      },
    },
    delete: {
      getHostEntityId: (args) => args[0],
      includeAfterOnDelete: true,
      metadata: (args, _result, beforeState) => ({
        bulkMessageId: args[0],
        name: beforeState?.bulkMessage?.name,
      }),
      getDescription: async (_args, _result, beforeState) => {
        const name = beforeState?.bulkMessage?.name || 'Unknown';
        return `Deleted bulk message "${name}"`;
      },
    },
  },
});
