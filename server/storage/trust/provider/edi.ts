import { createNoopValidator } from '../../utils/validation';
import { getClient } from '../../transaction-context';
import { trustProviderEdi, type TrustProviderEdi, type InsertTrustProviderEdi } from "../../../../shared/schema/trust/provider-edi-schema";
import { eq } from "drizzle-orm";
import type { StorageLoggingConfig } from "../../middleware/logging";

export const validate = createNoopValidator<InsertTrustProviderEdi, TrustProviderEdi>();

export interface TrustProviderEdiStorage {
  getAll(): Promise<TrustProviderEdi[]>;
  getById(id: string): Promise<TrustProviderEdi | undefined>;
  getBySiriusId(siriusId: string): Promise<TrustProviderEdi | undefined>;
  getByProviderId(providerId: string): Promise<TrustProviderEdi[]>;
  create(data: InsertTrustProviderEdi): Promise<TrustProviderEdi>;
  update(id: string, data: Partial<InsertTrustProviderEdi>): Promise<TrustProviderEdi | undefined>;
  delete(id: string): Promise<boolean>;
}

export function createTrustProviderEdiStorage(): TrustProviderEdiStorage {
  const storage: TrustProviderEdiStorage = {
    async getAll(): Promise<TrustProviderEdi[]> {
      const client = getClient();
      return await client.select().from(trustProviderEdi);
    },

    async getById(id: string): Promise<TrustProviderEdi | undefined> {
      const client = getClient();
      const [row] = await client
        .select()
        .from(trustProviderEdi)
        .where(eq(trustProviderEdi.id, id));
      return row || undefined;
    },

    async getBySiriusId(siriusId: string): Promise<TrustProviderEdi | undefined> {
      const client = getClient();
      const [row] = await client
        .select()
        .from(trustProviderEdi)
        .where(eq(trustProviderEdi.siriusId, siriusId));
      return row || undefined;
    },

    async getByProviderId(providerId: string): Promise<TrustProviderEdi[]> {
      const client = getClient();
      return await client
        .select()
        .from(trustProviderEdi)
        .where(eq(trustProviderEdi.providerId, providerId));
    },

    async create(data: InsertTrustProviderEdi): Promise<TrustProviderEdi> {
      validate.validateOrThrow(data);
      const client = getClient();
      const [row] = await client
        .insert(trustProviderEdi)
        .values(data)
        .returning();
      return row;
    },

    async update(id: string, data: Partial<InsertTrustProviderEdi>): Promise<TrustProviderEdi | undefined> {
      const client = getClient();
      const [updated] = await client
        .update(trustProviderEdi)
        .set(data)
        .where(eq(trustProviderEdi.id, id))
        .returning();
      return updated || undefined;
    },

    async delete(id: string): Promise<boolean> {
      const client = getClient();
      const result = await client
        .delete(trustProviderEdi)
        .where(eq(trustProviderEdi.id, id))
        .returning();
      return result.length > 0;
    },
  };

  return storage;
}

export const trustProviderEdiLoggingConfig: StorageLoggingConfig<TrustProviderEdiStorage> = {
  module: 'trustProviderEdi',
  methods: {
    create: {
      enabled: true,
      getEntityId: (args, result) => result?.id || 'new trust provider edi',
      getHostEntityId: (args, result) => result?.id,
      getDescription: async (args, result) => {
        const name = result?.name || args[0]?.name || 'Unnamed';
        return `Created Trust Provider EDI "${name}"`;
      },
      after: async (args, result) => {
        return {
          trustProviderEdi: result,
          metadata: {
            trustProviderEdiId: result?.id,
            siriusId: result?.siriusId,
            name: result?.name,
          }
        };
      }
    },
    update: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: (args) => args[0],
      getDescription: async (args, result, beforeState) => {
        const oldName = beforeState?.trustProviderEdi?.name || 'Unknown';
        const newName = result?.name || oldName;
        if (oldName !== newName) {
          return `Updated Trust Provider EDI "${oldName}" → "${newName}"`;
        }
        return `Updated Trust Provider EDI "${newName}"`;
      },
      before: async (args, storage) => {
        const trustProviderEdi = await storage.getById(args[0]);
        return { trustProviderEdi };
      },
      after: async (args, result, _storage, beforeState) => {
        return {
          trustProviderEdi: result,
          previousTrustProviderEdi: beforeState?.trustProviderEdi,
          metadata: {
            trustProviderEdiId: result?.id,
            siriusId: result?.siriusId,
            name: result?.name,
          }
        };
      }
    },
    delete: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: (args) => args[0],
      getDescription: async (args, result, beforeState) => {
        const name = beforeState?.trustProviderEdi?.name || 'Unknown';
        return `Deleted Trust Provider EDI "${name}"`;
      },
      before: async (args, storage) => {
        const trustProviderEdi = await storage.getById(args[0]);
        return { trustProviderEdi };
      },
      after: async (args, result, _storage, beforeState) => {
        return {
          deleted: result,
          trustProviderEdi: beforeState?.trustProviderEdi,
          metadata: {
            trustProviderEdiId: args[0],
            siriusId: beforeState?.trustProviderEdi?.siriusId,
            name: beforeState?.trustProviderEdi?.name,
          }
        };
      }
    },
  }
};
