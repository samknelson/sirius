import { db } from "../db";
import { ledgerAccounts, ledgerStripePaymentMethods, ledgerEa, ledgerPayments } from "@shared/schema";
import type { 
  LedgerAccount, 
  InsertLedgerAccount,
  LedgerStripePaymentMethod,
  InsertLedgerStripePaymentMethod,
  SelectLedgerEa,
  InsertLedgerEa,
  LedgerPayment,
  InsertLedgerPayment
} from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { withStorageLogging, type StorageLoggingConfig } from "./middleware/logging";

export interface LedgerAccountStorage {
  getAll(): Promise<LedgerAccount[]>;
  get(id: string): Promise<LedgerAccount | undefined>;
  create(account: InsertLedgerAccount): Promise<LedgerAccount>;
  update(id: string, account: Partial<InsertLedgerAccount>): Promise<LedgerAccount | undefined>;
  delete(id: string): Promise<boolean>;
}

export interface StripePaymentMethodStorage {
  getAll(): Promise<LedgerStripePaymentMethod[]>;
  get(id: string): Promise<LedgerStripePaymentMethod | undefined>;
  getByEntity(entityType: string, entityId: string): Promise<LedgerStripePaymentMethod[]>;
  create(method: InsertLedgerStripePaymentMethod): Promise<LedgerStripePaymentMethod>;
  update(id: string, method: Partial<InsertLedgerStripePaymentMethod>): Promise<LedgerStripePaymentMethod | undefined>;
  delete(id: string): Promise<boolean>;
  setAsDefault(paymentMethodId: string, entityType: string, entityId: string): Promise<LedgerStripePaymentMethod | undefined>;
}

export interface LedgerEaStorage {
  getAll(): Promise<SelectLedgerEa[]>;
  get(id: string): Promise<SelectLedgerEa | undefined>;
  getByEntity(entityType: string, entityId: string): Promise<SelectLedgerEa[]>;
  create(entry: InsertLedgerEa): Promise<SelectLedgerEa>;
  update(id: string, entry: Partial<InsertLedgerEa>): Promise<SelectLedgerEa | undefined>;
  delete(id: string): Promise<boolean>;
}

export interface LedgerPaymentStorage {
  getAll(): Promise<LedgerPayment[]>;
  get(id: string): Promise<LedgerPayment | undefined>;
  getByLedgerEaId(ledgerEaId: string): Promise<LedgerPayment[]>;
  create(payment: InsertLedgerPayment): Promise<LedgerPayment>;
  update(id: string, payment: Partial<InsertLedgerPayment>): Promise<LedgerPayment | undefined>;
  delete(id: string): Promise<boolean>;
}

export interface LedgerStorage {
  accounts: LedgerAccountStorage;
  stripePaymentMethods: StripePaymentMethodStorage;
  ea: LedgerEaStorage;
  payments: LedgerPaymentStorage;
}

export function createLedgerAccountStorage(): LedgerAccountStorage {
  return {
    async getAll(): Promise<LedgerAccount[]> {
      const results = await db.select().from(ledgerAccounts);
      return results;
    },

    async get(id: string): Promise<LedgerAccount | undefined> {
      const [account] = await db.select().from(ledgerAccounts).where(eq(ledgerAccounts.id, id));
      return account || undefined;
    },

    async create(insertAccount: InsertLedgerAccount): Promise<LedgerAccount> {
      const [account] = await db.insert(ledgerAccounts).values(insertAccount).returning();
      return account;
    },

    async update(id: string, accountUpdate: Partial<InsertLedgerAccount>): Promise<LedgerAccount | undefined> {
      const [account] = await db.update(ledgerAccounts)
        .set(accountUpdate)
        .where(eq(ledgerAccounts.id, id))
        .returning();
      return account || undefined;
    },

    async delete(id: string): Promise<boolean> {
      const result = await db.delete(ledgerAccounts).where(eq(ledgerAccounts.id, id));
      return result.rowCount ? result.rowCount > 0 : false;
    }
  };
}

export function createStripePaymentMethodStorage(): StripePaymentMethodStorage {
  return {
    async getAll(): Promise<LedgerStripePaymentMethod[]> {
      return await db.select().from(ledgerStripePaymentMethods)
        .orderBy(desc(ledgerStripePaymentMethods.createdAt));
    },

    async get(id: string): Promise<LedgerStripePaymentMethod | undefined> {
      const [paymentMethod] = await db.select().from(ledgerStripePaymentMethods)
        .where(eq(ledgerStripePaymentMethods.id, id));
      return paymentMethod || undefined;
    },

    async getByEntity(entityType: string, entityId: string): Promise<LedgerStripePaymentMethod[]> {
      return await db.select().from(ledgerStripePaymentMethods)
        .where(and(
          eq(ledgerStripePaymentMethods.entityType, entityType),
          eq(ledgerStripePaymentMethods.entityId, entityId)
        ))
        .orderBy(desc(ledgerStripePaymentMethods.isDefault), desc(ledgerStripePaymentMethods.createdAt));
    },

    async create(insertPaymentMethod: InsertLedgerStripePaymentMethod): Promise<LedgerStripePaymentMethod> {
      const [paymentMethod] = await db.insert(ledgerStripePaymentMethods)
        .values(insertPaymentMethod)
        .returning();
      return paymentMethod;
    },

    async update(id: string, paymentMethodUpdate: Partial<InsertLedgerStripePaymentMethod>): Promise<LedgerStripePaymentMethod | undefined> {
      const [paymentMethod] = await db.update(ledgerStripePaymentMethods)
        .set(paymentMethodUpdate)
        .where(eq(ledgerStripePaymentMethods.id, id))
        .returning();
      return paymentMethod || undefined;
    },

    async delete(id: string): Promise<boolean> {
      const result = await db.delete(ledgerStripePaymentMethods)
        .where(eq(ledgerStripePaymentMethods.id, id))
        .returning();
      return result.length > 0;
    },

    async setAsDefault(paymentMethodId: string, entityType: string, entityId: string): Promise<LedgerStripePaymentMethod | undefined> {
      await db
        .update(ledgerStripePaymentMethods)
        .set({ isDefault: false })
        .where(and(
          eq(ledgerStripePaymentMethods.entityType, entityType),
          eq(ledgerStripePaymentMethods.entityId, entityId)
        ));
      
      const [paymentMethod] = await db
        .update(ledgerStripePaymentMethods)
        .set({ isDefault: true })
        .where(and(
          eq(ledgerStripePaymentMethods.id, paymentMethodId),
          eq(ledgerStripePaymentMethods.entityType, entityType),
          eq(ledgerStripePaymentMethods.entityId, entityId)
        ))
        .returning();
      
      return paymentMethod || undefined;
    }
  };
}

export function createLedgerEaStorage(): LedgerEaStorage {
  return {
    async getAll(): Promise<SelectLedgerEa[]> {
      return await db.select().from(ledgerEa);
    },

    async get(id: string): Promise<SelectLedgerEa | undefined> {
      const [entry] = await db.select().from(ledgerEa).where(eq(ledgerEa.id, id));
      return entry || undefined;
    },

    async getByEntity(entityType: string, entityId: string): Promise<SelectLedgerEa[]> {
      return await db.select().from(ledgerEa)
        .where(and(
          eq(ledgerEa.entityType, entityType),
          eq(ledgerEa.entityId, entityId)
        ));
    },

    async create(insertEntry: InsertLedgerEa): Promise<SelectLedgerEa> {
      const [entry] = await db.insert(ledgerEa).values(insertEntry).returning();
      return entry;
    },

    async update(id: string, entryUpdate: Partial<InsertLedgerEa>): Promise<SelectLedgerEa | undefined> {
      const [entry] = await db.update(ledgerEa)
        .set(entryUpdate)
        .where(eq(ledgerEa.id, id))
        .returning();
      return entry || undefined;
    },

    async delete(id: string): Promise<boolean> {
      const result = await db.delete(ledgerEa).where(eq(ledgerEa.id, id));
      return result.rowCount ? result.rowCount > 0 : false;
    }
  };
}

export function createLedgerPaymentStorage(): LedgerPaymentStorage {
  return {
    async getAll(): Promise<LedgerPayment[]> {
      return await db.select().from(ledgerPayments)
        .orderBy(desc(ledgerPayments.id));
    },

    async get(id: string): Promise<LedgerPayment | undefined> {
      const [payment] = await db.select().from(ledgerPayments)
        .where(eq(ledgerPayments.id, id));
      return payment || undefined;
    },

    async getByLedgerEaId(ledgerEaId: string): Promise<LedgerPayment[]> {
      return await db.select().from(ledgerPayments)
        .where(eq(ledgerPayments.ledgerEaId, ledgerEaId))
        .orderBy(desc(ledgerPayments.id));
    },

    async create(insertPayment: InsertLedgerPayment): Promise<LedgerPayment> {
      const [payment] = await db.insert(ledgerPayments)
        .values(insertPayment as any)
        .returning();
      return payment;
    },

    async update(id: string, paymentUpdate: Partial<InsertLedgerPayment>): Promise<LedgerPayment | undefined> {
      const [payment] = await db.update(ledgerPayments)
        .set(paymentUpdate as any)
        .where(eq(ledgerPayments.id, id))
        .returning();
      return payment || undefined;
    },

    async delete(id: string): Promise<boolean> {
      const result = await db.delete(ledgerPayments)
        .where(eq(ledgerPayments.id, id));
      return result.rowCount ? result.rowCount > 0 : false;
    }
  };
}

export function createLedgerStorage(
  accountLoggingConfig?: StorageLoggingConfig<LedgerAccountStorage>,
  stripePaymentMethodLoggingConfig?: StorageLoggingConfig<StripePaymentMethodStorage>,
  eaLoggingConfig?: StorageLoggingConfig<LedgerEaStorage>,
  paymentLoggingConfig?: StorageLoggingConfig<LedgerPaymentStorage>
): LedgerStorage {
  // Create nested storage instances with optional logging
  const accountStorage = accountLoggingConfig
    ? withStorageLogging(createLedgerAccountStorage(), accountLoggingConfig)
    : createLedgerAccountStorage();
  
  const stripePaymentMethodStorage = stripePaymentMethodLoggingConfig
    ? withStorageLogging(createStripePaymentMethodStorage(), stripePaymentMethodLoggingConfig)
    : createStripePaymentMethodStorage();

  const eaStorage = eaLoggingConfig
    ? withStorageLogging(createLedgerEaStorage(), eaLoggingConfig)
    : createLedgerEaStorage();

  const paymentStorage = paymentLoggingConfig
    ? withStorageLogging(createLedgerPaymentStorage(), paymentLoggingConfig)
    : createLedgerPaymentStorage();
  
  return {
    accounts: accountStorage,
    stripePaymentMethods: stripePaymentMethodStorage,
    ea: eaStorage,
    payments: paymentStorage
  };
}
