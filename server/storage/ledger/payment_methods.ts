import { createNoopValidator } from '../utils/validation';
import { getClient } from '../transaction-context';
import { ledgerPaymentMethods } from "@shared/schema";
import type {
  LedgerPaymentMethod,
  LedgerPaymentMethodWithCreatedDate,
  InsertLedgerPaymentMethod,
} from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { defineLoggingConfig } from "../middleware/logging";

/**
 * Stub validator - add validation logic here when needed
 */
const validate = createNoopValidator();

export interface PaymentMethodStorage {
  /** Every method, newest first. Carries the provenance creation date it is ordered by. */
  getAll(): Promise<LedgerPaymentMethodWithCreatedDate[]>;
  get(id: string): Promise<LedgerPaymentMethod | undefined>;
  /**
   * One entity's methods, defaults first and newest first within that — the
   * order and the date both come from provenance, which is where a record's
   * creation date lives.
   */
  getByEntity(entityType: string, entityId: string): Promise<LedgerPaymentMethodWithCreatedDate[]>;
  create(method: InsertLedgerPaymentMethod): Promise<LedgerPaymentMethod>;
  update(id: string, method: Partial<InsertLedgerPaymentMethod>): Promise<LedgerPaymentMethod | undefined>;
  delete(id: string): Promise<boolean>;
  setAsDefault(paymentMethodId: string, entityType: string, entityId: string, gatewayConfigId: string): Promise<LedgerPaymentMethod | undefined>;
}

/**
 * Join condition reaching a payment method's provenance row.
 *
 * A payment method no longer carries its own `created_at`: when it was added
 * is provenance, kept in `entity_metadata` under the method's own id. The
 * screen shows that date and both list reads order by it. The table name is
 * part of the condition even though `entity_id` is unique: a row naming
 * another table is not this method's history.
 */
/**
 * Newest first, and a method whose provenance has not landed yet counts as the
 * newest thing there is: the stamp is written moments after the insert
 * commits, so the only rows without one are the ones just added.
 */
const newestFirst = sql`${ledgerPaymentMethods.createdAt} DESC NULLS LAST`;

export function createPaymentMethodStorage(): PaymentMethodStorage {
  return {
    async getAll(): Promise<LedgerPaymentMethodWithCreatedDate[]> {
      const client = getClient();
      const rows = await client
        .select({ method: ledgerPaymentMethods, createdDate: ledgerPaymentMethods.createdAt })
        .from(ledgerPaymentMethods)
        .orderBy(newestFirst);
      return rows.map(row => ({ ...row.method, createdDate: row.createdDate }));
    },

    async get(id: string): Promise<LedgerPaymentMethod | undefined> {
      const client = getClient();
      const [paymentMethod] = await client.select().from(ledgerPaymentMethods)
        .where(eq(ledgerPaymentMethods.id, id));
      return paymentMethod || undefined;
    },

    async getByEntity(entityType: string, entityId: string): Promise<LedgerPaymentMethodWithCreatedDate[]> {
      const client = getClient();
      const rows = await client
        .select({ method: ledgerPaymentMethods, createdDate: ledgerPaymentMethods.createdAt })
        .from(ledgerPaymentMethods)
        .where(and(
          eq(ledgerPaymentMethods.entityType, entityType),
          eq(ledgerPaymentMethods.entityId, entityId)
        ))
        .orderBy(desc(ledgerPaymentMethods.isDefault), newestFirst);
      return rows.map(row => ({ ...row.method, createdDate: row.createdDate }));
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
  table: 'ledger_paymentmethods',
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
