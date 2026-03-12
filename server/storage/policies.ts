import { createNoopValidator } from './utils/validation';
import { getClient } from './transaction-context';
import { policies, type Policy, type InsertPolicy } from "@shared/schema";
import { eq } from "drizzle-orm";
import type { StorageLoggingConfig } from "./middleware/logging";

/**
 * Stub validator - add validation logic here when needed
 */
export const validate = createNoopValidator<InsertPolicy, Policy>();

export interface PolicyStorage {
  getAllPolicies(): Promise<Policy[]>;
  getPolicyById(id: string): Promise<Policy | undefined>;
  getPolicyBySiriusId(siriusId: string): Promise<Policy | undefined>;
  createPolicy(data: InsertPolicy): Promise<Policy>;
  updatePolicy(id: string, data: Partial<InsertPolicy>): Promise<Policy | undefined>;
  deletePolicy(id: string): Promise<boolean>;
}

export function createPolicyStorage(): PolicyStorage {
  const storage: PolicyStorage = {
    async getAllPolicies(): Promise<Policy[]> {
      const client = getClient();
      return await client.select().from(policies);
    },

    async getPolicyById(id: string): Promise<Policy | undefined> {
      const client = getClient();
      const [policy] = await client
        .select()
        .from(policies)
        .where(eq(policies.id, id));
      return policy || undefined;
    },

    async getPolicyBySiriusId(siriusId: string): Promise<Policy | undefined> {
      const client = getClient();
      const [policy] = await client
        .select()
        .from(policies)
        .where(eq(policies.siriusId, siriusId));
      return policy || undefined;
    },

    async createPolicy(data: InsertPolicy): Promise<Policy> {
      validate.validateOrThrow(data);
      const client = getClient();
      const [policy] = await client
        .insert(policies)
        .values(data)
        .returning();
      return policy;
    },

    async updatePolicy(id: string, data: Partial<InsertPolicy>): Promise<Policy | undefined> {
      validate.validateOrThrow(id);
      const client = getClient();
      const [updated] = await client
        .update(policies)
        .set(data)
        .where(eq(policies.id, id))
        .returning();
      return updated || undefined;
    },

    async deletePolicy(id: string): Promise<boolean> {
      const client = getClient();
      const result = await client
        .delete(policies)
        .where(eq(policies.id, id))
        .returning();
      return result.length > 0;
    },
  };

  return storage;
}

export const policyLoggingConfig: StorageLoggingConfig<PolicyStorage> = {
  module: 'policies',
  methods: {
    createPolicy: {
      enabled: true,
      getEntityId: (args, result) => result?.id || 'new policy',
      getDescription: async (args, result) => {
        const name = result?.name || args[0]?.name || 'Unnamed';
        const siriusId = result?.siriusId || args[0]?.siriusId || '';
        return `Created Policy [${siriusId}] ${name}`;
      },
      after: async (args, result) => {
        return {
          policy: result,
          metadata: {
            policyId: result?.id,
            siriusId: result?.siriusId,
            name: result?.name,
          }
        };
      }
    },
    updatePolicy: {
      enabled: true,
      getEntityId: (args) => args[0],
      getDescription: async (args, result, beforeState) => {
        const oldName = beforeState?.policy?.name || 'Unknown';
        const newName = result?.name || oldName;
        const siriusId = result?.siriusId || beforeState?.policy?.siriusId || '';
        if (oldName !== newName) {
          return `Updated Policy [${siriusId}] ${oldName} → ${newName}`;
        }
        return `Updated Policy [${siriusId}] ${newName}`;
      },
      before: async (args, storage) => {
        const policy = await storage.getPolicyById(args[0]);
        return { policy };
      },
      after: async (args, result, _storage, beforeState) => {
        return {
          policy: result,
          previousPolicy: beforeState?.policy,
          metadata: {
            policyId: result?.id,
            siriusId: result?.siriusId,
            name: result?.name,
          }
        };
      }
    },
    deletePolicy: {
      enabled: true,
      getEntityId: (args) => args[0],
      getDescription: async (args, result, beforeState) => {
        const name = beforeState?.policy?.name || 'Unknown';
        const siriusId = beforeState?.policy?.siriusId || '';
        return `Deleted Policy [${siriusId}] ${name}`;
      },
      before: async (args, storage) => {
        const policy = await storage.getPolicyById(args[0]);
        return { policy };
      },
      after: async (args, result, _storage, beforeState) => {
        return {
          deleted: result,
          policy: beforeState?.policy,
          metadata: {
            policyId: args[0],
            siriusId: beforeState?.policy?.siriusId,
            name: beforeState?.policy?.name,
          }
        };
      }
    },
  }
};
