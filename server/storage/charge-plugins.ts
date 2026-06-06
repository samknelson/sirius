import { createNoopValidator } from './utils/validation';
import { getClient } from './transaction-context';
import { chargePluginConfigs, type ChargePluginConfig, type InsertChargePluginConfig } from "@shared/schema";
import { eq, and, isNull } from "drizzle-orm";

/**
 * Stub validator - add validation logic here when needed
 */
export const validate = createNoopValidator();

export interface ChargePluginConfigStorage {
  getAll(): Promise<ChargePluginConfig[]>;
  get(id: string): Promise<ChargePluginConfig | undefined>;
  getByPluginId(pluginId: string): Promise<ChargePluginConfig[]>;
  getFirstEnabledByPluginId(pluginId: string): Promise<ChargePluginConfig | undefined>;
  getByPluginIdAndScope(pluginId: string, scope: string, employerId?: string): Promise<ChargePluginConfig | undefined>;
  getByUniqueKey(pluginId: string, scope: string, employerId: string | null, account: string | null): Promise<ChargePluginConfig | undefined>;
  getEnabledForPlugin(pluginId: string, employerId: string | null): Promise<ChargePluginConfig[]>;
  create(config: InsertChargePluginConfig): Promise<ChargePluginConfig>;
  update(id: string, config: Partial<InsertChargePluginConfig>): Promise<ChargePluginConfig | undefined>;
  delete(id: string): Promise<boolean>;
}

export function createChargePluginConfigStorage(): ChargePluginConfigStorage {
  return {
    async getAll(): Promise<ChargePluginConfig[]> {
      const client = getClient();
      const allConfigs = await client.select().from(chargePluginConfigs);
      return allConfigs.sort((a, b) => a.pluginId.localeCompare(b.pluginId));
    },

    async get(id: string): Promise<ChargePluginConfig | undefined> {
      const client = getClient();
      const [config] = await client.select().from(chargePluginConfigs).where(eq(chargePluginConfigs.id, id));
      return config || undefined;
    },

    async getByPluginId(pluginId: string): Promise<ChargePluginConfig[]> {
      const client = getClient();
      const configs = await client.select().from(chargePluginConfigs).where(eq(chargePluginConfigs.pluginId, pluginId));
      return configs;
    },

    async getFirstEnabledByPluginId(pluginId: string): Promise<ChargePluginConfig | undefined> {
      const client = getClient();
      // Deterministic selection: prefer a config that has an account set
      // (account ASC puts NULLs last in Postgres), then by id for a stable
      // tiebreak. With per-account configs there can be multiple enabled rows.
      const [config] = await client
        .select()
        .from(chargePluginConfigs)
        .where(and(eq(chargePluginConfigs.pluginId, pluginId), eq(chargePluginConfigs.enabled, true)))
        .orderBy(chargePluginConfigs.account, chargePluginConfigs.id)
        .limit(1);
      return config || undefined;
    },

    async getByPluginIdAndScope(pluginId: string, scope: string, employerId?: string): Promise<ChargePluginConfig | undefined> {
      const client = getClient();
      const conditions = [
        eq(chargePluginConfigs.pluginId, pluginId),
        eq(chargePluginConfigs.scope, scope),
      ];

      // Constrain the employer dimension by scope so a global/batch lookup
      // never accidentally matches an employer-scoped row, and an employer
      // lookup without an id only matches the null-employer rows.
      if (scope === "employer") {
        conditions.push(
          employerId
            ? eq(chargePluginConfigs.employerId, employerId)
            : isNull(chargePluginConfigs.employerId),
        );
      } else {
        conditions.push(isNull(chargePluginConfigs.employerId));
      }

      // Deterministic selection when multiple per-account rows exist: prefer a
      // config with an account set (account ASC = NULLs last), then id.
      const [config] = await client
        .select()
        .from(chargePluginConfigs)
        .where(and(...conditions))
        .orderBy(chargePluginConfigs.account, chargePluginConfigs.id)
        .limit(1);

      return config || undefined;
    },

    async getByUniqueKey(
      pluginId: string,
      scope: string,
      employerId: string | null,
      account: string | null,
    ): Promise<ChargePluginConfig | undefined> {
      const client = getClient();
      const conditions = [
        eq(chargePluginConfigs.pluginId, pluginId),
        eq(chargePluginConfigs.scope, scope),
        employerId ? eq(chargePluginConfigs.employerId, employerId) : isNull(chargePluginConfigs.employerId),
        account ? eq(chargePluginConfigs.account, account) : isNull(chargePluginConfigs.account),
      ];

      const [config] = await client
        .select()
        .from(chargePluginConfigs)
        .where(and(...conditions));

      return config || undefined;
    },

    async getEnabledForPlugin(pluginId: string, employerId: string | null): Promise<ChargePluginConfig[]> {
      const client = getClient();
      const baseConditions = [
        eq(chargePluginConfigs.pluginId, pluginId),
        eq(chargePluginConfigs.enabled, true),
      ];

      // Get all enabled global configs (one per account).
      const globalConfigs = await client
        .select()
        .from(chargePluginConfigs)
        .where(
          and(
            ...baseConditions,
            eq(chargePluginConfigs.scope, "global")
          )
        );

      if (!employerId) {
        return globalConfigs;
      }

      // Get all enabled employer-specific configs for this employer.
      const employerConfigs = await client
        .select()
        .from(chargePluginConfigs)
        .where(
          and(
            ...baseConditions,
            eq(chargePluginConfigs.scope, "employer"),
            eq(chargePluginConfigs.employerId, employerId)
          )
        );

      if (employerConfigs.length === 0) {
        return globalConfigs;
      }

      // Employer configs override global configs that target the same account.
      const overriddenAccounts = new Set(employerConfigs.map((c) => c.account ?? "__null__"));
      const remainingGlobals = globalConfigs.filter(
        (g) => !overriddenAccounts.has(g.account ?? "__null__")
      );

      return [...remainingGlobals, ...employerConfigs];
    },

    async create(insertConfig: InsertChargePluginConfig): Promise<ChargePluginConfig> {
      validate.validateOrThrow(insertConfig);
      const client = getClient();
      const [config] = await client
        .insert(chargePluginConfigs)
        .values(insertConfig)
        .returning();
      return config;
    },

    async update(id: string, configUpdate: Partial<InsertChargePluginConfig>): Promise<ChargePluginConfig | undefined> {
      validate.validateOrThrow(id);
      const client = getClient();
      const [config] = await client
        .update(chargePluginConfigs)
        .set(configUpdate)
        .where(eq(chargePluginConfigs.id, id))
        .returning();
      
      return config || undefined;
    },

    async delete(id: string): Promise<boolean> {
      const client = getClient();
      const result = await client.delete(chargePluginConfigs).where(eq(chargePluginConfigs.id, id)).returning();
      return result.length > 0;
    }
  };
}
