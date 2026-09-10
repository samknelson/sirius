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
 *
 * `upsert` is the only way a mapping is ever written, so it is also the only
 * place a mapping's creation can be observed — and it is not named like a
 * create, so nothing about the name says which of the two it did. The mode is
 * therefore decided per call, from whether a mapping was already there: the
 * insert that first links an entity to a provider customer is that record's
 * creation and stamps whoever caused it, while the repair of a stale reference
 * is a modification and leaves the original creator alone.
 *
 * Both happen on a vendor round-trip — the mapping is written as a side effect
 * of asking the provider for a customer — so the acting person is whoever's
 * request set that off, and may be nobody at all when the work has no request
 * behind it.
 */
export const gatewayCustomerLoggingConfig = defineLoggingConfig<GatewayCustomerStorage>({
  module: 'ledger.gatewayCustomers',
  table: 'ledger_gateway_customers',
  methods: {
    upsert: {
      getEntityId: (args, result) => result?.id || 'new gateway customer',
      before: async (args, storage) => {
        const mapping = args[0] as InsertLedgerGatewayCustomer | undefined;
        if (!mapping) return undefined;
        return await storage.get(
          mapping.entityType,
          mapping.entityId,
          mapping.gatewayConfigId,
        );
      },
      metadataMode: (_args, _result, beforeState) => (beforeState ? 'modified' : 'created'),
    },
  },
});
