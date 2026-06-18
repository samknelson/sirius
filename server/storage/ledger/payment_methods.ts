import { createNoopValidator } from '../utils/validation';
import { getClient } from '../transaction-context';
import { ledgerPaymentMethods } from "@shared/schema";
import type { LedgerPaymentMethod, InsertLedgerPaymentMethod } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { defineLoggingConfig } from "../middleware/logging";

/**
 * Stub validator - add validation logic here when needed
 */
const validate = createNoopValidator();

export interface PaymentMethodStorage {
  getAll(): Promise<LedgerPaymentMethod[]>;
  get(id: string): Promise<LedgerPaymentMethod | undefined>;
  getByEntity(entityType: string, entityId: string): Promise<LedgerPaymentMethod[]>;
  create(method: InsertLedgerPaymentMethod): Promise<LedgerPaymentMethod>;
  update(id: string, method: Partial<InsertLedgerPaymentMethod>): Promise<LedgerPaymentMethod | undefined>;
  delete(id: string): Promise<boolean>;
  setAsDefault(paymentMethodId: string, entityType: string, entityId: string, gatewayConfigId: string): Promise<LedgerPaymentMethod | undefined>;
}

export function createPaymentMethodStorage(): PaymentMethodStorage {
  return {
    async getAll(): Promise<LedgerPaymentMethod[]> {
      const client = getClient();
      return await client.select().from(ledgerPaymentMethods)
        .orderBy(desc(ledgerPaymentMethods.createdAt));
    },

    async get(id: string): Promise<LedgerPaymentMethod | undefined> {
      const client = getClient();
      const [paymentMethod] = await client.select().from(ledgerPaymentMethods)
        .where(eq(ledgerPaymentMethods.id, id));
      return paymentMethod || undefined;
    },

    async getByEntity(entityType: string, entityId: string): Promise<LedgerPaymentMethod[]> {
      const client = getClient();
      return await client.select().from(ledgerPaymentMethods)
        .where(and(
          eq(ledgerPaymentMethods.entityType, entityType),
          eq(ledgerPaymentMethods.entityId, entityId)
        ))
        .orderBy(desc(ledgerPaymentMethods.isDefault), desc(ledgerPaymentMethods.createdAt));
    },

    async create(insertPaymentMethod: InsertLedgerPaymentMethod): Promise<LedgerPaymentMethod> {
      validate.validateOrThrow(insertPaymentMethod);
      const client = getClient();
      const [paymentMethod] = await client.insert(ledgerPaymentMethods)
        .values(insertPaymentMethod)
        .returning();
      return paymentMethod;
    },

    async update(id: string, paymentMethodUpdate: Partial<InsertLedgerPaymentMethod>): Promise<LedgerPaymentMethod | undefined> {
      validate.validateOrThrow(id);
      const client = getClient();
      const [paymentMethod] = await client.update(ledgerPaymentMethods)
        .set(paymentMethodUpdate)
        .where(eq(ledgerPaymentMethods.id, id))
        .returning();
      return paymentMethod || undefined;
    },

    async delete(id: string): Promise<boolean> {
      const client = getClient();
      const result = await client.delete(ledgerPaymentMethods)
        .where(eq(ledgerPaymentMethods.id, id))
        .returning();
      return result.length > 0;
    },

    async setAsDefault(paymentMethodId: string, entityType: string, entityId: string, gatewayConfigId: string): Promise<LedgerPaymentMethod | undefined> {
      const client = getClient();
      // A default only makes sense within a single gateway, so only clear the
      // default flag for other methods on the SAME gateway. Methods on other
      // gateways keep their own default.
      await client
        .update(ledgerPaymentMethods)
        .set({ isDefault: false })
        .where(and(
          eq(ledgerPaymentMethods.entityType, entityType),
          eq(ledgerPaymentMethods.entityId, entityId),
          eq(ledgerPaymentMethods.gatewayConfigId, gatewayConfigId)
        ));

      const [paymentMethod] = await client
        .update(ledgerPaymentMethods)
        .set({ isDefault: true })
        .where(and(
          eq(ledgerPaymentMethods.id, paymentMethodId),
          eq(ledgerPaymentMethods.entityType, entityType),
          eq(ledgerPaymentMethods.entityId, entityId)
        ))
        .returning();

      return paymentMethod || undefined;
    }
  };
}

/**
 * Logging configuration for payment method storage operations
 *
 * Logs all payment method mutations with full argument capture and change tracking.
 */
export const paymentMethodLoggingConfig = defineLoggingConfig<PaymentMethodStorage>({
  module: 'ledger.paymentMethods',
  methods: {
    create: { getEntityId: (args, result) => result?.id || 'new payment method' },
    update: {},
    delete: {},
    setAsDefault: {
      getEntityId: (args) => args[0],
      before: async (args, storage) => await storage.get(args[0]),
      after: async (args, result) => result,
    },
  },
});
