import { db } from "../db";
import { ledgerAccounts, ledgerStripePaymentMethods } from "@shared/schema";
import type { 
  LedgerAccount, 
  InsertLedgerAccount,
  LedgerStripePaymentMethod,
  InsertLedgerStripePaymentMethod
} from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";

export interface LedgerAccountStorage {
  getAllLedgerAccounts(): Promise<LedgerAccount[]>;
  getLedgerAccount(id: string): Promise<LedgerAccount | undefined>;
  createLedgerAccount(account: InsertLedgerAccount): Promise<LedgerAccount>;
  updateLedgerAccount(id: string, account: Partial<InsertLedgerAccount>): Promise<LedgerAccount | undefined>;
  deleteLedgerAccount(id: string): Promise<boolean>;
}

export interface StripePaymentMethodStorage {
  getAllLedgerStripePaymentMethods(): Promise<LedgerStripePaymentMethod[]>;
  getLedgerStripePaymentMethod(id: string): Promise<LedgerStripePaymentMethod | undefined>;
  getLedgerStripePaymentMethodsByEntity(entityType: string, entityId: string): Promise<LedgerStripePaymentMethod[]>;
  createLedgerStripePaymentMethod(method: InsertLedgerStripePaymentMethod): Promise<LedgerStripePaymentMethod>;
  updateLedgerStripePaymentMethod(id: string, method: Partial<InsertLedgerStripePaymentMethod>): Promise<LedgerStripePaymentMethod | undefined>;
  deleteLedgerStripePaymentMethod(id: string): Promise<boolean>;
}

export interface LedgerStorage {
  accounts: LedgerAccountStorage;
  stripePaymentMethods: StripePaymentMethodStorage;
}

export function createLedgerAccountStorage(): LedgerAccountStorage {
  return {
    async getAllLedgerAccounts(): Promise<LedgerAccount[]> {
      const results = await db.select().from(ledgerAccounts);
      return results;
    },

    async getLedgerAccount(id: string): Promise<LedgerAccount | undefined> {
      const [account] = await db.select().from(ledgerAccounts).where(eq(ledgerAccounts.id, id));
      return account || undefined;
    },

    async createLedgerAccount(insertAccount: InsertLedgerAccount): Promise<LedgerAccount> {
      const [account] = await db.insert(ledgerAccounts).values(insertAccount).returning();
      return account;
    },

    async updateLedgerAccount(id: string, accountUpdate: Partial<InsertLedgerAccount>): Promise<LedgerAccount | undefined> {
      const [account] = await db.update(ledgerAccounts)
        .set(accountUpdate)
        .where(eq(ledgerAccounts.id, id))
        .returning();
      return account || undefined;
    },

    async deleteLedgerAccount(id: string): Promise<boolean> {
      const result = await db.delete(ledgerAccounts).where(eq(ledgerAccounts.id, id));
      return result.rowCount ? result.rowCount > 0 : false;
    }
  };
}

export function createStripePaymentMethodStorage(): StripePaymentMethodStorage {
  return {
    async getAllLedgerStripePaymentMethods(): Promise<LedgerStripePaymentMethod[]> {
      return await db.select().from(ledgerStripePaymentMethods)
        .orderBy(desc(ledgerStripePaymentMethods.createdAt));
    },

    async getLedgerStripePaymentMethod(id: string): Promise<LedgerStripePaymentMethod | undefined> {
      const [paymentMethod] = await db.select().from(ledgerStripePaymentMethods)
        .where(eq(ledgerStripePaymentMethods.id, id));
      return paymentMethod || undefined;
    },

    async getLedgerStripePaymentMethodsByEntity(entityType: string, entityId: string): Promise<LedgerStripePaymentMethod[]> {
      return await db.select().from(ledgerStripePaymentMethods)
        .where(and(
          eq(ledgerStripePaymentMethods.entityType, entityType),
          eq(ledgerStripePaymentMethods.entityId, entityId)
        ))
        .orderBy(desc(ledgerStripePaymentMethods.isDefault), desc(ledgerStripePaymentMethods.createdAt));
    },

    async createLedgerStripePaymentMethod(insertPaymentMethod: InsertLedgerStripePaymentMethod): Promise<LedgerStripePaymentMethod> {
      const [paymentMethod] = await db.insert(ledgerStripePaymentMethods)
        .values(insertPaymentMethod)
        .returning();
      return paymentMethod;
    },

    async updateLedgerStripePaymentMethod(id: string, paymentMethodUpdate: Partial<InsertLedgerStripePaymentMethod>): Promise<LedgerStripePaymentMethod | undefined> {
      const [paymentMethod] = await db.update(ledgerStripePaymentMethods)
        .set(paymentMethodUpdate)
        .where(eq(ledgerStripePaymentMethods.id, id))
        .returning();
      return paymentMethod || undefined;
    },

    async deleteLedgerStripePaymentMethod(id: string): Promise<boolean> {
      const result = await db.delete(ledgerStripePaymentMethods)
        .where(eq(ledgerStripePaymentMethods.id, id))
        .returning();
      return result.length > 0;
    }
  };
}

export function createLedgerStorage(): LedgerStorage {
  return {
    accounts: createLedgerAccountStorage(),
    stripePaymentMethods: createStripePaymentMethodStorage()
  };
}
