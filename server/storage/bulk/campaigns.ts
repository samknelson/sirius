import { createNoopValidator } from '../utils/validation';
import { getClient } from '../transaction-context';
import {
  bulkCampaigns,
  bulkMessages,
  type BulkCampaign,
  type InsertBulkCampaign,
  type BulkMessage,
} from "../../../shared/schema/bulk/schema";
import { eq, and, ilike, desc, type SQL } from "drizzle-orm";
import type { StorageLoggingConfig } from "../middleware/logging";

export const validate = createNoopValidator<InsertBulkCampaign, BulkCampaign>();

export interface BulkCampaignStorage {
  getAll(filters?: { status?: string; name?: string }): Promise<BulkCampaign[]>;
  getById(id: string): Promise<BulkCampaign | undefined>;
  getByIdWithMessages(id: string): Promise<(BulkCampaign & { messages: BulkMessage[] }) | undefined>;
  create(data: InsertBulkCampaign): Promise<BulkCampaign>;
  update(id: string, data: Partial<InsertBulkCampaign>): Promise<BulkCampaign | undefined>;
  delete(id: string): Promise<boolean>;
  getMessagesByCampaignId(campaignId: string): Promise<BulkMessage[]>;
}

export function createBulkCampaignStorage(): BulkCampaignStorage {
  const storage: BulkCampaignStorage = {
    async getAll(filters?: { status?: string; name?: string }): Promise<BulkCampaign[]> {
      const client = getClient();
      const conditions: SQL[] = [];
      if (filters?.status) {
        conditions.push(eq(bulkCampaigns.status, filters.status as any));
      }
      if (filters?.name) {
        conditions.push(ilike(bulkCampaigns.name, `%${filters.name}%`));
      }
      if (conditions.length > 0) {
        return await client.select().from(bulkCampaigns).where(and(...conditions)).orderBy(desc(bulkCampaigns.createdAt));
      }
      return await client.select().from(bulkCampaigns).orderBy(desc(bulkCampaigns.createdAt));
    },

    async getById(id: string): Promise<BulkCampaign | undefined> {
      const client = getClient();
      const [row] = await client
        .select()
        .from(bulkCampaigns)
        .where(eq(bulkCampaigns.id, id));
      return row || undefined;
    },

    async getByIdWithMessages(id: string): Promise<(BulkCampaign & { messages: BulkMessage[] }) | undefined> {
      const client = getClient();
      const [campaign] = await client
        .select()
        .from(bulkCampaigns)
        .where(eq(bulkCampaigns.id, id));
      if (!campaign) return undefined;
      const messages = await client
        .select()
        .from(bulkMessages)
        .where(eq(bulkMessages.campaignId, id));
      return { ...campaign, messages };
    },

    async create(data: InsertBulkCampaign): Promise<BulkCampaign> {
      validate.validateOrThrow(data);
      const client = getClient();
      const [row] = await client
        .insert(bulkCampaigns)
        .values(data)
        .returning();
      return row;
    },

    async update(id: string, data: Partial<InsertBulkCampaign>): Promise<BulkCampaign | undefined> {
      const client = getClient();
      const [updated] = await client
        .update(bulkCampaigns)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(bulkCampaigns.id, id))
        .returning();
      return updated || undefined;
    },

    async delete(id: string): Promise<boolean> {
      const client = getClient();
      const result = await client
        .delete(bulkCampaigns)
        .where(eq(bulkCampaigns.id, id))
        .returning();
      return result.length > 0;
    },

    async getMessagesByCampaignId(campaignId: string): Promise<BulkMessage[]> {
      const client = getClient();
      return await client
        .select()
        .from(bulkMessages)
        .where(eq(bulkMessages.campaignId, campaignId));
    },
  };

  return storage;
}

export const bulkCampaignLoggingConfig: StorageLoggingConfig<BulkCampaignStorage> = {
  module: 'bulkCampaigns',
  methods: {
    create: {
      enabled: true,
      getEntityId: (args, result) => result?.id || 'new campaign',
      getHostEntityId: (args, result) => result?.id,
      getDescription: async (args, result) => {
        const name = result?.name || args[0]?.name || 'Unnamed';
        return `Created bulk campaign "${name}"`;
      },
      after: async (args, result) => {
        return {
          campaign: result,
          metadata: {
            campaignId: result?.id,
            name: result?.name,
            status: result?.status,
            channels: result?.channels,
          }
        };
      }
    },
    update: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: (args) => args[0],
      getDescription: async (args, result, beforeState) => {
        const oldName = beforeState?.campaign?.name || 'Unknown';
        const newName = result?.name || oldName;
        if (oldName !== newName) {
          return `Updated bulk campaign "${oldName}" → "${newName}"`;
        }
        return `Updated bulk campaign "${newName}"`;
      },
      before: async (args, storage) => {
        const campaign = await storage.getById(args[0]);
        return { campaign };
      },
      after: async (args, result, _storage, beforeState) => {
        return {
          campaign: result,
          previousCampaign: beforeState?.campaign,
          metadata: {
            campaignId: result?.id,
            name: result?.name,
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
        const name = beforeState?.campaign?.name || 'Unknown';
        return `Deleted bulk campaign "${name}"`;
      },
      before: async (args, storage) => {
        const campaign = await storage.getById(args[0]);
        return { campaign };
      },
      after: async (args, result, _storage, beforeState) => {
        return {
          deleted: result,
          campaign: beforeState?.campaign,
          metadata: {
            campaignId: args[0],
            name: beforeState?.campaign?.name,
          }
        };
      }
    },
  }
};
