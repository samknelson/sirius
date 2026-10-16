import { createNoopValidator } from '../utils/validation';
import { getClient } from '../transaction-context';
import { bulkMessages, type BulkMessage, type InsertBulkMessage } from "../../../shared/schema/bulk/schema";
import { eq, and, ilike, sql, type SQL } from "drizzle-orm";
import { defineLoggingConfig } from "../middleware/logging";

export const validate = createNoopValidator<InsertBulkMessage, BulkMessage>();

export interface BulkMessageStorage {
  getAll(filters?: { status?: string; medium?: string; name?: string }): Promise<BulkMessage[]>;
  getById(id: string): Promise<BulkMessage | undefined>;
  /** Must be called within a transaction; serializes recipient handoff with draft changes. */
  getForUpdate(id: string): Promise<BulkMessage | undefined>;
  getEligibleDrafts(): Promise<BulkMessage[]>;
  /** Permanently close recipient handoff before any participant vendor call. */
  markDeliveryStarted(id: string): Promise<void>;
  create(data: InsertBulkMessage): Promise<BulkMessage>;
  update(id: string, data: Partial<InsertBulkMessage>): Promise<BulkMessage | undefined>;
  delete(id: string): Promise<boolean>;
}

export function createBulkMessageStorage(): BulkMessageStorage {
  const storage: BulkMessageStorage = {
    async getForUpdate(id) {
      const [row] = await getClient().select().from(bulkMessages).where(eq(bulkMessages.id, id)).for("update");
      return row;
    },
    async getEligibleDrafts() {
      return getClient().select().from(bulkMessages).where(sql`
        ${bulkMessages.status} = 'draft'
        AND (${bulkMessages.data}->>'recipientDeliveryStarted') IS DISTINCT FROM 'true'
        AND jsonb_array_length(to_jsonb(${bulkMessages.medium})) > 0
        AND NOT EXISTS (
          SELECT 1 FROM bulk_participants bp WHERE bp.message_id = ${bulkMessages.id}
          AND (bp.status <> 'pending' OR bp.comm_id IS NOT NULL)
        )
      `);
    },
    async markDeliveryStarted(id) {
      // UPDATE takes the same row lock as handoff. Commit before contacting a
      // vendor, so a crash/lost response cannot reopen a partially used draft.
      const rows = await getClient().update(bulkMessages).set({
        data: sql`COALESCE(${bulkMessages.data}, '{}'::jsonb) || '{"recipientDeliveryStarted":true}'::jsonb`,
      }).where(eq(bulkMessages.id, id)).returning({ id: bulkMessages.id });
      if (!rows.length) throw new Error("Bulk message no longer exists");
    },
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
        .set({
          ...data,
          ...(data.data !== undefined ? {
            data: sql`CASE WHEN ${bulkMessages.data}->>'recipientDeliveryStarted' = 'true'
              THEN COALESCE(${JSON.stringify(data.data)}::jsonb, '{}'::jsonb) || '{"recipientDeliveryStarted":true}'::jsonb
              ELSE ${JSON.stringify(data.data)}::jsonb END`,
          } : {}),
        })
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
  table: 'bulk_messages',
  state: { key: 'bulkMessage' },
  getter: 'getById',
  methods: {
    create: {
      state: { fallbackId: 'new bulk message' },
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
      state: { previousKey: 'previousBulkMessage' },
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
      state: { includeOnDelete: true },
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
