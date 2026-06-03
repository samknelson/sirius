import { createNoopValidator } from './utils/validation';
import { getClient } from './transaction-context';
import { policies, type Policy, type InsertPolicy } from "@shared/schema";
import { eq } from "drizzle-orm";
import { defineLoggingConfig } from "./middleware/logging";

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
  getData(id: string): Promise<Record<string, unknown>>;
  setData(id: string, data: Record<string, unknown>): Promise<void>;
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

    async getData(id: string): Promise<Record<string, unknown>> {
      const client = getClient();
      const [row] = await client
        .select({ data: policies.data })
        .from(policies)
        .where(eq(policies.id, id));
      if (!row) {
        throw new Error("POLICY_NOT_FOUND");
      }
      const data = row.data;
      return data && typeof data === "object" && !Array.isArray(data)
        ? (data as Record<string, unknown>)
        : {};
    },

    async setData(id: string, data: Record<string, unknown>): Promise<void> {
      const client = getClient();
      const result = await client
        .update(policies)
        .set({ data })
        .where(eq(policies.id, id))
        .returning({ id: policies.id });
      if (result.length === 0) {
        throw new Error("POLICY_NOT_FOUND");
      }
    },
  };

  return storage;
}

const policyDescribe = {
  label: 'Policy',
  name: 'name',
  id: 'siriusId',
} as const;

export const policyLoggingConfig = defineLoggingConfig<PolicyStorage>({
  module: 'policies',
  state: { key: 'policy' },
  getter: 'getPolicyById',
  methods: {
    createPolicy: {
      state: { fallbackId: 'new policy' },
      describe: { ...policyDescribe, defaultName: 'Unnamed' },
      metadata: (_args, result) => ({
        policyId: result?.id,
        siriusId: result?.siriusId,
        name: result?.name,
      }),
    },
    updatePolicy: {
      state: { previousKey: 'previousPolicy' },
      describe: policyDescribe,
      metadata: (_args, result) => ({
        policyId: result?.id,
        siriusId: result?.siriusId,
        name: result?.name,
      }),
    },
    deletePolicy: {
      state: { includeOnDelete: true },
      describe: policyDescribe,
      metadata: (args, _result, beforeState) => ({
        policyId: args[0],
        siriusId: beforeState?.policy?.siriusId,
        name: beforeState?.policy?.name,
      }),
    },
    setData: {
      getEntityId: (args) => args[0],
      getHostEntityId: (args) => args[0],
      getDescription: () => 'Updated policy data',
      metadata: (args) => ({ policyId: args[0] }),
    },
  },
});
