import { createNoopValidator } from './utils/validation';
import { getClient } from './transaction-context';
import { chargePluginConfigs, type ChargePluginConfig, type InsertChargePluginConfig } from "@shared/schema";
import { eq, and } from "drizzle-orm";

/**
 * Stub validator - add validation logic here when needed
 */
export const validate = createNoopValidator();

export interface ChargePluginConfigStorage {
  getAll(): Promise<ChargePluginConfig[]>;
  get(id: string): Promise<ChargePluginConfig | undefined>;
  getByPluginId(pluginId: string): Promise<ChargePluginConfig[]>;
  getByPluginIdAndScope(pluginId: string, scope: string, employerId?: string): Promise<ChargePluginConfig | undefined>;
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

    async getByPluginIdAndScope(pluginId: string, scope: string, employerId?: string): Promise<ChargePluginConfig | undefined> {
      const client = getClient();
      const conditions = [
        eq(chargePluginConfigs.pluginId, pluginId),
        eq(chargePluginConfigs.scope, scope),
      ];

      if (scope === "employer" && employerId) {
        conditions.push(eq(chargePluginConfigs.employerId, employerId));
      }

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

      // Get global config
      const globalConfig = await client
        .select()
        .from(chargePluginConfigs)
        .where(
          and(
            ...baseConditions,
            eq(chargePluginConfigs.scope, "global")
          )
        )
        .limit(1);

      // If employer-specific, also get employer config (which overrides global)
      if (employerId) {
        const employerConfig = await client
          .select()
          .from(chargePluginConfigs)
          .where(
            and(
              ...baseConditions,
              eq(chargePluginConfigs.scope, "employer"),
              eq(chargePluginConfigs.employerId, employerId)
            )
          )
          .limit(1);

        // Return employer config if exists, otherwise global
        if (employerConfig.length > 0) {
          return employerConfig;
        }
      }

      return globalConfig;
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
