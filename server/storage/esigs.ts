import { createNoopValidator } from './utils/validation';
import { getClient } from './transaction-context';
import { esigs, users, type Esig, type InsertEsig } from "@shared/schema";
import { eq } from "drizzle-orm";
import type { StorageLoggingConfig } from "./middleware/logging";

export const validate = createNoopValidator();

export interface EsigWithSigner extends Esig {
  signer?: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
  };
}

export interface EsigStorage {
  getEsigById(id: string): Promise<EsigWithSigner | undefined>;
  createEsig(data: InsertEsig): Promise<Esig>;
  updateEsig(id: string, data: Partial<InsertEsig>): Promise<Esig | undefined>;
}

export function createEsigStorage(): EsigStorage {
  const storage: EsigStorage = {
    async getEsigById(id: string): Promise<EsigWithSigner | undefined> {
      const client = getClient();
      const result = await client
        .select({
          esig: esigs,
          user: {
            id: users.id,
            email: users.email,
            firstName: users.firstName,
            lastName: users.lastName,
          },
        })
        .from(esigs)
        .leftJoin(users, eq(esigs.userId, users.id))
        .where(eq(esigs.id, id));
      
      if (!result.length) return undefined;
      
      const { esig, user } = result[0];
      return {
        ...esig,
        signer: user ? {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
        } : undefined,
      };
    },

    async createEsig(data: InsertEsig): Promise<Esig> {
      validate.validateOrThrow(data);
      const client = getClient();
      const [esig] = await client
        .insert(esigs)
        .values(data)
        .returning();
      return esig;
    },

    async updateEsig(id: string, data: Partial<InsertEsig>): Promise<Esig | undefined> {
      validate.validateOrThrow(id);
      const client = getClient();
      const [updated] = await client
        .update(esigs)
        .set(data)
        .where(eq(esigs.id, id))
        .returning();
      return updated || undefined;
    },
  };

  return storage;
}

export const esigLoggingConfig: StorageLoggingConfig<EsigStorage> = {
  module: 'esigs',
  methods: {
    createEsig: {
      enabled: true,
      getEntityId: (args, result) => result?.id || 'new esig',
      getHostEntityId: (args, result) => result?.userId || args[0]?.userId,
      getDescription: async (args, result) => {
        return `Created e-signature for document type: ${result?.docType || args[0]?.docType || 'unknown'}`;
      },
      after: async (args, result) => {
        return {
          esig: result,
          metadata: {
            esigId: result?.id,
            userId: result?.userId,
            docType: result?.docType,
            status: result?.status,
          }
        };
      }
    },
    updateEsig: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: async (args, result, beforeState) => {
        return result?.userId || beforeState?.esig?.userId;
      },
      getDescription: async (args, result, beforeState) => {
        const oldStatus = beforeState?.esig?.status;
        const newStatus = result?.status;
        if (oldStatus && newStatus && oldStatus !== newStatus) {
          return `Updated e-signature: ${oldStatus} → ${newStatus}`;
        }
        return `Updated e-signature`;
      },
      before: async (args, storage) => {
        const esig = await storage.getEsigById(args[0]);
        return { esig };
      },
      after: async (args, result, _storage, beforeState) => {
        return {
          esig: result,
          previousState: beforeState?.esig,
          metadata: {
            esigId: result?.id,
            userId: result?.userId,
            docType: result?.docType,
            status: result?.status,
            previousStatus: beforeState?.esig?.status,
          }
        };
      }
    },
  },
};
