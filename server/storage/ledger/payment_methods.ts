import { createNoopValidator } from '../utils/validation';
import { getClient } from '../transaction-context';
import { entityMetadata, ledgerPaymentMethods } from "@shared/schema";
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
  upsertProviderMethod(input: {
    entityType: string;
    entityId: string;
    gatewayConfigId: string;
    providerMethodRef: string;
    consent?: unknown;
    data?: unknown;
  }): Promise<LedgerPaymentMethod>;
}

/**
 * Join condition reaching a payment method's provenance row.
 *
 * When a method was added is provenance, kept in `entity_metadata` under the
 * method's own id. The screen shows that date and both list reads order by it.
 * The table name is part of the condition even though `entity_id` is unique:
 * a row naming another table is not this method's history.
 */
/**
 * Newest first, and a method whose provenance has not landed yet counts as the
 * newest thing there is: the stamp is written moments after the insert
 * commits, so the only rows without one are the ones just added.
 */
const newestFirst = sql`${entityMetadata.createdDate} DESC NULLS LAST`;

export function createPaymentMethodStorage(): PaymentMethodStorage {
  return {
    async getAll(): Promise<LedgerPaymentMethodWithCreatedDate[]> {
      const client = getClient();
      const rows = await client
        .select({ method: ledgerPaymentMethods, createdDate: entityMetadata.createdDate, createdBy: entityMetadata.createdBy })
        .from(ledgerPaymentMethods)
        .leftJoin(entityMetadata, and(
          eq(entityMetadata.contextId, "ledger_paymentmethods"),
          eq(entityMetadata.entityId, ledgerPaymentMethods.id),
        ))
        .orderBy(newestFirst);
      return rows.map(row => ({ ...row.method, consent: publicConsent(row.method.consent), createdDate: row.createdDate, createdBy: row.createdBy }));
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
        .select({ method: ledgerPaymentMethods, createdDate: entityMetadata.createdDate, createdBy: entityMetadata.createdBy })
        .from(ledgerPaymentMethods)
        .leftJoin(entityMetadata, and(
          eq(entityMetadata.contextId, "ledger_paymentmethods"),
          eq(entityMetadata.entityId, ledgerPaymentMethods.id),
        ))
        .where(and(
          eq(ledgerPaymentMethods.entityType, entityType),
          eq(ledgerPaymentMethods.entityId, entityId)
        ))
        .orderBy(desc(ledgerPaymentMethods.isDefault), newestFirst);
      return rows.map(row => ({ ...row.method, consent: publicConsent(row.method.consent), createdDate: row.createdDate, createdBy: row.createdBy }));
    },

    async create(insertPaymentMethod: InsertLedgerPaymentMethod): Promise<LedgerPaymentMethod> {
      validate.validateOrThrow(insertPaymentMethod);
      const client = getClient();
      const [paymentMethod] = await client.insert(ledgerPaymentMethods)
        .values({ ...insertPaymentMethod, providerMethodRef: insertPaymentMethod.paymentMethod })
        .returning();
      return paymentMethod;
    },

    async update(id: string, paymentMethodUpdate: Partial<InsertLedgerPaymentMethod>): Promise<LedgerPaymentMethod | undefined> {
      validate.validateOrThrow(id);
      const client = getClient();
      const [paymentMethod] = await client.update(ledgerPaymentMethods)
        .set({ ...paymentMethodUpdate, ...(paymentMethodUpdate.paymentMethod !== undefined ? { providerMethodRef: paymentMethodUpdate.paymentMethod } : {}) })
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
    },

    async upsertProviderMethod(input): Promise<LedgerPaymentMethod> {
      const client = getClient();
      const [method] = await client
        .insert(ledgerPaymentMethods)
        .values({
          entityType: input.entityType,
          entityId: input.entityId,
          gatewayConfigId: input.gatewayConfigId,
          paymentMethod: input.providerMethodRef,
          providerMethodRef: input.providerMethodRef,
          consent: input.consent ?? null,
          data: input.data ?? {},
          isActive: true,
          isDefault: false,
        })
        .onConflictDoUpdate({
          target: [ledgerPaymentMethods.gatewayConfigId, ledgerPaymentMethods.providerMethodRef],
          setWhere: and(
            eq(ledgerPaymentMethods.entityType, input.entityType),
            eq(ledgerPaymentMethods.entityId, input.entityId),
          ),
          set: {
            isActive: true,
            ...(input.consent !== undefined ? { consent: input.consent } : {}),
            ...(input.data !== undefined ? { data: input.data } : {}),
          },
        })
        .returning();
      if (!method) throw new Error("Provider payment method could not be stored");
      if (method.entityType !== input.entityType || method.entityId !== input.entityId) {
        throw new Error("Provider payment method belongs to a different entity");
      }
      return method;
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
    create: {
      logArgs: (args) => [auditMethod(args[0])],
      after: async (_args, result) => auditMethod(result),
      getEntityId: (args, result) => result?.id || 'new payment method',
      metadataEntityId: (_args, result) => result?.id,
    },
    update: {
      logArgs: (args) => [args[0], auditMethod(args[1])],
      before: async (args, storage) => auditMethod(await storage.get(args[0])),
      after: async (_args, result) => auditMethod(result),
      metadataEntityId: (args, result, beforeState) => result?.id ?? beforeState?.id ?? args[0],
    },
    delete: {
      logArgs: (args) => [args[0]],
      before: async (args, storage) => auditMethod(await storage.get(args[0])),
      after: async () => undefined,
      metadataEntityId: (args, result, beforeState) => result?.id ?? beforeState?.id ?? args[0],
    },
    setAsDefault: {
      getEntityId: (args) => args[0],
      metadataEntityId: (args) => args[0],
      logArgs: (args) => args.slice(0, 4),
      before: async (args, storage) => auditMethod(await storage.get(args[0])),
      after: async (_args, result) => auditMethod(result),
    },
  },
});

function publicConsent(value: unknown): unknown {
  if (!value || typeof value !== "object") return null;
  const consent = value as Record<string, unknown>;
  return { textVersion: consent.textVersion, acceptedAt: consent.acceptedAt };
}

function auditMethod(value: Partial<LedgerPaymentMethod> | undefined) {
  if (!value) return undefined;
  return {
    id: value.id, entityType: value.entityType, entityId: value.entityId,
    gatewayConfigId: value.gatewayConfigId, isActive: value.isActive,
    isDefault: value.isDefault,
  };
}
