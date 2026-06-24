import { createNoopValidator } from './utils/validation';
import { getClient, runInTransaction } from './transaction-context';
import {
  policies,
  type Policy,
  type InsertPolicy,
  type PluginConfigBenefitEligibility,
} from "@shared/schema";
import { eq } from "drizzle-orm";
import { defineLoggingConfig } from "./middleware/logging";
import type { PluginConfigStorage } from "./plugin-configs";

/** Plugin kind that owns the per-policy trust-eligibility configurations. */
const TRUST_ELIGIBILITY_KIND = "trust-eligibility" as const;

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
  /**
   * Deep-copy a policy into a brand-new one. Copies the source's `data`
   * (including its `benefitIds` benefit assignments) under a freshly
   * generated unique Sirius ID, then recreates every trust-eligibility
   * plugin config scoped to the source policy (base config + benefit
   * eligibility subsidiary) re-pointed at the new policy. Runs in a single
   * transaction and never mutates the source.
   */
  duplicatePolicy(sourceId: string, newName: string): Promise<Policy | undefined>;
  getData(id: string): Promise<Record<string, unknown>>;
  setData(id: string, data: Record<string, unknown>): Promise<void>;
}

export function createPolicyStorage(pluginConfigs: PluginConfigStorage): PolicyStorage {
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

    async duplicatePolicy(sourceId: string, newName: string): Promise<Policy | undefined> {
      return runInTransaction(async () => {
        const client = getClient();

        const [source] = await client
          .select()
          .from(policies)
          .where(eq(policies.id, sourceId));
        if (!source) {
          return undefined;
        }

        // Generate a fresh, unique Sirius ID derived from the source's. The
        // lookups read through the same transaction client, so they also see
        // any row inserted earlier in this transaction.
        const base = `${source.siriusId}-COPY`;
        let siriusId = base;
        let suffix = 1;
        while (await storage.getPolicyBySiriusId(siriusId)) {
          suffix += 1;
          siriusId = `${base}-${suffix}`;
        }

        const [newPolicy] = await client
          .insert(policies)
          .values({
            siriusId,
            name: newName,
            data: source.data ?? null,
          })
          .returning();

        // Copy every trust-eligibility config scoped to the source policy,
        // recreating each base config plus its benefit-eligibility subsidiary
        // re-pointed at the new policy. Reads and writes both go through the
        // pluginConfigs storage namespace. The unique `siriusId` is
        // intentionally not copied — the new rows are manual (null) like a
        // fresh create.
        const sourceConfigs = await pluginConfigs.search(TRUST_ELIGIBILITY_KIND, {
          policy: sourceId,
        });

        if (sourceConfigs.length > 0) {
          await pluginConfigs.bulkCreateWithSubsidiary(
            TRUST_ELIGIBILITY_KIND,
            sourceConfigs.map(({ config, subsidiary }) => {
              const sub = subsidiary as PluginConfigBenefitEligibility | null;
              return {
                base: {
                  pluginKind: config.pluginKind,
                  pluginId: config.pluginId,
                  enabled: config.enabled,
                  name: config.name,
                  ordering: config.ordering,
                  data: config.data,
                },
                subsidiary: {
                  policy: newPolicy.id,
                  benefit: sub?.benefit ?? null,
                  appliesTo: sub?.appliesTo ?? null,
                },
              };
            }),
          );
        }

        return newPolicy;
      });
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
    duplicatePolicy: {
      state: { fallbackId: 'new policy' },
      describe: { ...policyDescribe, defaultName: 'Unnamed' },
      metadata: (args, result) => ({
        policyId: result?.id,
        siriusId: result?.siriusId,
        name: result?.name,
        sourcePolicyId: args[0],
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
