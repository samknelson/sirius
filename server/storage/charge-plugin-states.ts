import { createNoopValidator } from './utils/validation';
import { getClient } from './transaction-context';
import { chargePluginStates, type ChargePluginState } from "@shared/schema";
import { eq, sql } from "drizzle-orm";

/**
 * Stub validator - add validation logic here when needed
 */
export const validate = createNoopValidator();

export interface ChargePluginStateStorage {
  getAll(): Promise<ChargePluginState[]>;
  /**
   * Returns whether a plugin's master switch is enabled. Absence of a row
   * means enabled (preserves pre-existing behavior).
   */
  isEnabled(pluginId: string): Promise<boolean>;
  setEnabled(pluginId: string, enabled: boolean): Promise<ChargePluginState>;
}

export function createChargePluginStateStorage(): ChargePluginStateStorage {
  return {
    async getAll(): Promise<ChargePluginState[]> {
      const client = getClient();
      return client.select().from(chargePluginStates);
    },

    async isEnabled(pluginId: string): Promise<boolean> {
      const client = getClient();
      const [state] = await client
        .select()
        .from(chargePluginStates)
        .where(eq(chargePluginStates.pluginId, pluginId));
      // No row => enabled by default.
      return state ? state.enabled : true;
    },

    async setEnabled(pluginId: string, enabled: boolean): Promise<ChargePluginState> {
      const client = getClient();
      const [state] = await client
        .insert(chargePluginStates)
        .values({ pluginId, enabled })
        .onConflictDoUpdate({
          target: chargePluginStates.pluginId,
          set: { enabled, updatedAt: sql`now()` },
        })
        .returning();
      return state;
    },
  };
}
