import { db } from "../db";
import { chargePluginConfigs, type ChargePluginConfig, type InsertChargePluginConfig } from "@shared/schema";
import { eq, and } from "drizzle-orm";

export interface ChargePluginConfigStorage {
  getAll(): Promise<ChargePluginConfig[]>;
  get(id: string): Promise<ChargePluginConfig | undefined>;
  getByPluginId(pluginId: string): Promise<ChargePluginConfig[]>;
  getByPluginIdAndScope(pluginId: string, scope: string, employerId?: string): Promise<ChargePluginConfig | undefined>;
  create(config: InsertChargePluginConfig): Promise<ChargePluginConfig>;
  update(id: string, config: Partial<InsertChargePluginConfig>): Promise<ChargePluginConfig | undefined>;
  delete(id: string): Promise<boolean>;
}

export function createChargePluginConfigStorage(): ChargePluginConfigStorage {
  return {
    async getAll(): Promise<ChargePluginConfig[]> {
      const allConfigs = await db.select().from(chargePluginConfigs);
      return allConfigs.sort((a, b) => a.pluginId.localeCompare(b.pluginId));
    },

    async get(id: string): Promise<ChargePluginConfig | undefined> {
      const [config] = await db.select().from(chargePluginConfigs).where(eq(chargePluginConfigs.id, id));
      return config || undefined;
    },

    async getByPluginId(pluginId: string): Promise<ChargePluginConfig[]> {
      const configs = await db.select().from(chargePluginConfigs).where(eq(chargePluginConfigs.pluginId, pluginId));
      return configs;
    },

    async getByPluginIdAndScope(pluginId: string, scope: string, employerId?: string): Promise<ChargePluginConfig | undefined> {
      const conditions = [
        eq(chargePluginConfigs.pluginId, pluginId),
        eq(chargePluginConfigs.scope, scope),
      ];

      if (scope === "employer" && employerId) {
        conditions.push(eq(chargePluginConfigs.employerId, employerId));
      }

      const [config] = await db
        .select()
        .from(chargePluginConfigs)
        .where(and(...conditions));

      return config || undefined;
    },

    async create(insertConfig: InsertChargePluginConfig): Promise<ChargePluginConfig> {
      const [config] = await db
        .insert(chargePluginConfigs)
        .values(insertConfig)
        .returning();
      return config;
    },

    async update(id: string, configUpdate: Partial<InsertChargePluginConfig>): Promise<ChargePluginConfig | undefined> {
      const [config] = await db
        .update(chargePluginConfigs)
        .set(configUpdate)
        .where(eq(chargePluginConfigs.id, id))
        .returning();
      
      return config || undefined;
    },

    async delete(id: string): Promise<boolean> {
      const result = await db.delete(chargePluginConfigs).where(eq(chargePluginConfigs.id, id)).returning();
      return result.length > 0;
    }
  };
}
