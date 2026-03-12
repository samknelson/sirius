import { createNoopValidator } from './utils/validation';
import { getClient } from './transaction-context';
import { trustProviders, InsertTrustProvider, TrustProvider } from "@shared/schema";
import { eq } from "drizzle-orm";
import { withStorageLogging, type StorageLoggingConfig } from "./middleware/logging";

/**
 * Stub validator - add validation logic here when needed
 */
export const validate = createNoopValidator();

export interface TrustProviderStorage {
  getAllTrustProviders(): Promise<TrustProvider[]>;
  getTrustProvider(id: string): Promise<TrustProvider | undefined>;
  createTrustProvider(provider: InsertTrustProvider): Promise<TrustProvider>;
  updateTrustProvider(id: string, provider: Partial<InsertTrustProvider>): Promise<TrustProvider | undefined>;
  deleteTrustProvider(id: string): Promise<boolean>;
}

const loggingConfig: StorageLoggingConfig<TrustProviderStorage> = {
  module: 'trust-providers',
  methods: {
    createTrustProvider: {
      enabled: true,
      getEntityId: (args, result) => result?.id,
      getHostEntityId: (args, result) => result?.id,
      after: async (args, result) => result,
    },
    updateTrustProvider: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: (args) => args[0],
      before: async (args, storage) => await storage.getTrustProvider(args[0]),
      after: async (args, result) => result,
    },
    deleteTrustProvider: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: (args) => args[0],
      before: async (args, storage) => await storage.getTrustProvider(args[0]),
    },
  },
};

function createTrustProviderStorageInternal(): TrustProviderStorage {
  return {
    async getAllTrustProviders(): Promise<TrustProvider[]> {
      const client = getClient();
      const results = await client
        .select()
        .from(trustProviders)
        .orderBy(trustProviders.name);
      
      return results;
    },

    async getTrustProvider(id: string): Promise<TrustProvider | undefined> {
      const client = getClient();
      const [provider] = await client
        .select()
        .from(trustProviders)
        .where(eq(trustProviders.id, id));
      
      return provider || undefined;
    },

    async createTrustProvider(provider: InsertTrustProvider): Promise<TrustProvider> {
      validate.validateOrThrow(provider);
      const client = getClient();
      try {
        const [newProvider] = await client
          .insert(trustProviders)
          .values(provider)
          .returning();
        return newProvider;
      } catch (error: any) {
        if (error.code === '23505') {
          throw new Error("A trust provider with this ID already exists");
        }
        throw error;
      }
    },

    async updateTrustProvider(id: string, provider: Partial<InsertTrustProvider>): Promise<TrustProvider | undefined> {
      validate.validateOrThrow(id);
      const client = getClient();
      try {
        const [updatedProvider] = await client
          .update(trustProviders)
          .set(provider)
          .where(eq(trustProviders.id, id))
          .returning();
        return updatedProvider || undefined;
      } catch (error: any) {
        if (error.code === '23505') {
          throw new Error("A trust provider with this ID already exists");
        }
        throw error;
      }
    },

    async deleteTrustProvider(id: string): Promise<boolean> {
      const client = getClient();
      const result = await client.delete(trustProviders).where(eq(trustProviders.id, id)).returning();
      return result.length > 0;
    }
  };
}

export function createTrustProviderStorage(): TrustProviderStorage {
  return withStorageLogging(createTrustProviderStorageInternal(), loggingConfig);
}
