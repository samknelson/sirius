import { getClient } from '../transaction-context';
import { ledgerGatewayCustomers } from "@shared/schema";
import type { LedgerGatewayCustomer, InsertLedgerGatewayCustomer } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { defineLoggingConfig } from "../middleware/logging";

/**
 * Storage for the per-(entity, gateway config) provider customer mapping.
 * Replaces the old single `employers.stripe_customer_id` column so an entity
 * can carry a distinct provider customer reference per gateway config.
 */
export interface GatewayCustomerStorage {
  get(
    entityType: string,
    entityId: string,
    gatewayConfigId: string,
  ): Promise<LedgerGatewayCustomer | undefined>;
  /**
   * Insert the customer mapping for the tuple, or update its customerRef when a
   * mapping already exists. This repairs stale references (e.g. a deleted
   * provider customer) instead of silently keeping the old value.
   */
  upsert(mapping: InsertLedgerGatewayCustomer): Promise<LedgerGatewayCustomer>;
}

export function createGatewayCustomerStorage(): GatewayCustomerStorage {
  return {
    async get(entityType, entityId, gatewayConfigId) {
      const client = getClient();
      const [row] = await client
        .select()
        .from(ledgerGatewayCustomers)
        .where(and(
          eq(ledgerGatewayCustomers.entityType, entityType),
          eq(ledgerGatewayCustomers.entityId, entityId),
          eq(ledgerGatewayCustomers.gatewayConfigId, gatewayConfigId),
        ));
      return row || undefined;
    },

    async upsert(mapping) {
      const client = getClient();
      const [row] = await client
        .insert(ledgerGatewayCustomers)
        .values(mapping)
        .onConflictDoUpdate({
          target: [
            ledgerGatewayCustomers.entityType,
            ledgerGatewayCustomers.entityId,
            ledgerGatewayCustomers.gatewayConfigId,
          ],
          set: { customerRef: mapping.customerRef },
        })
        .returning();
      return row;
    },
  };
}

/**
 * Logging configuration for gateway-customer mapping operations.
 */
export const gatewayCustomerLoggingConfig = defineLoggingConfig<GatewayCustomerStorage>({
  module: 'ledger.gatewayCustomers',
  methods: {
    upsert: { getEntityId: (args, result) => result?.id || 'new gateway customer' },
  },
});
