import { db } from "../db";
import { ledgerAccounts, ledgerStripePaymentMethods, ledgerEa, ledgerPayments, ledger, employers, workers, contacts, trustProviders } from "@shared/schema";
import type { 
  LedgerAccount, 
  InsertLedgerAccount,
  LedgerStripePaymentMethod,
  InsertLedgerStripePaymentMethod,
  SelectLedgerEa,
  InsertLedgerEa,
  LedgerPayment,
  InsertLedgerPayment,
  LedgerPaymentWithEntity,
  Ledger,
  InsertLedger
} from "@shared/schema";
import { eq, and, desc, or, isNull } from "drizzle-orm";
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
  getByAccountIdWithEntity(accountId: string): Promise<LedgerPaymentWithEntity[]>;
  getByAccountIdWithEntityPaginated(
    accountId: string, 
    limit: number, 
    offset: number
  ): Promise<{ data: LedgerPaymentWithEntity[]; total: number }>;
  create(payment: InsertLedgerPayment): Promise<LedgerPayment>;
  update(id: string, payment: Partial<InsertLedgerPayment>): Promise<LedgerPayment | undefined>;
  delete(id: string): Promise<boolean>;
}

export interface LedgerEntryStorage {
  getAll(): Promise<Ledger[]>;
  get(id: string): Promise<Ledger | undefined>;
  getByEaId(eaId: string): Promise<Ledger[]>;
  getByReference(referenceType: string, referenceId: string): Promise<Ledger[]>;
  getTransactions(filter: { accountId: string } | { eaId: string }): Promise<LedgerEntryWithDetails[]>;
  getByAccountId(accountId: string): Promise<LedgerEntryWithDetails[]>;
  create(entry: InsertLedger): Promise<Ledger>;
  update(id: string, entry: Partial<InsertLedger>): Promise<Ledger | undefined>;
  delete(id: string): Promise<boolean>;
  deleteByReference(referenceType: string, referenceId: string): Promise<number>;
}

export interface LedgerEntryWithDetails extends Ledger {
  entityType: string;
  entityId: string;
  entityName: string | null;
  eaAccountId: string;
}

export interface LedgerStorage {
  accounts: LedgerAccountStorage;
  stripePaymentMethods: StripePaymentMethodStorage;
  ea: LedgerEaStorage;
  payments: LedgerPaymentStorage;
  entries: LedgerEntryStorage;
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

    async getByAccountIdWithEntity(accountId: string): Promise<LedgerPaymentWithEntity[]> {
      const results = await db
        .select({
          payment: ledgerPayments,
          ea: ledgerEa,
          employer: employers
        })
        .from(ledgerPayments)
        .innerJoin(ledgerEa, eq(ledgerPayments.ledgerEaId, ledgerEa.id))
        .leftJoin(
          employers,
          and(
            eq(ledgerEa.entityType, 'employer'),
            eq(ledgerEa.entityId, employers.id)
          )
        )
        .where(eq(ledgerEa.accountId, accountId))
        .orderBy(desc(ledgerPayments.id));

      return results.map(row => ({
        ...row.payment,
        entityType: row.ea.entityType,
        entityId: row.ea.entityId,
        entityName: row.employer?.name || null
      }));
    },

    async getByAccountIdWithEntityPaginated(
      accountId: string,
      limit: number,
      offset: number
    ): Promise<{ data: LedgerPaymentWithEntity[]; total: number }> {
      const [countResult] = await db
        .select({
          count: db.$count(ledgerPayments.id)
        })
        .from(ledgerPayments)
        .innerJoin(ledgerEa, eq(ledgerPayments.ledgerEaId, ledgerEa.id))
        .where(eq(ledgerEa.accountId, accountId));

      const total = Number(countResult?.count || 0);

      const results = await db
        .select({
          payment: ledgerPayments,
          ea: ledgerEa,
          employer: employers
        })
        .from(ledgerPayments)
        .innerJoin(ledgerEa, eq(ledgerPayments.ledgerEaId, ledgerEa.id))
        .leftJoin(
          employers,
          and(
            eq(ledgerEa.entityType, 'employer'),
            eq(ledgerEa.entityId, employers.id)
          )
        )
        .where(eq(ledgerEa.accountId, accountId))
        .orderBy(desc(ledgerPayments.id))
        .limit(limit)
        .offset(offset);

      const data = results.map(row => ({
        ...row.payment,
        entityType: row.ea.entityType,
        entityId: row.ea.entityId,
        entityName: row.employer?.name || null
      }));

      return { data, total };
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

export function createLedgerEntryStorage(): LedgerEntryStorage {
  return {
    async getAll(): Promise<Ledger[]> {
      return await db.select().from(ledger);
    },

    async get(id: string): Promise<Ledger | undefined> {
      const [entry] = await db.select().from(ledger).where(eq(ledger.id, id));
      return entry || undefined;
    },

    async getByEaId(eaId: string): Promise<Ledger[]> {
      return await db.select().from(ledger)
        .where(eq(ledger.eaId, eaId));
    },

    async getByReference(referenceType: string, referenceId: string): Promise<Ledger[]> {
      return await db.select().from(ledger)
        .where(and(
          eq(ledger.referenceType, referenceType),
          eq(ledger.referenceId, referenceId)
        ));
    },

    async getTransactions(filter: { accountId: string } | { eaId: string }): Promise<LedgerEntryWithDetails[]> {
      const query = db
        .select({
          entry: ledger,
          ea: ledgerEa,
          employer: employers,
          trustProvider: trustProviders,
          workerSiriusId: workers.siriusId,
          workerContact: contacts,
        })
        .from(ledger)
        .innerJoin(ledgerEa, eq(ledger.eaId, ledgerEa.id))
        .leftJoin(
          employers,
          and(
            eq(ledgerEa.entityType, 'employer'),
            eq(ledgerEa.entityId, employers.id)
          )
        )
        .leftJoin(
          trustProviders,
          and(
            eq(ledgerEa.entityType, 'trustProvider'),
            eq(ledgerEa.entityId, trustProviders.id)
          )
        )
        .leftJoin(
          workers,
          and(
            eq(ledgerEa.entityType, 'worker'),
            eq(ledgerEa.entityId, workers.id)
          )
        )
        .leftJoin(
          contacts,
          and(
            eq(ledgerEa.entityType, 'worker'),
            eq(workers.contactId, contacts.id)
          )
        );

      const whereClause = 'accountId' in filter
        ? eq(ledgerEa.accountId, filter.accountId)
        : eq(ledger.eaId, filter.eaId);

      const results = await query
        .where(whereClause)
        .orderBy(desc(ledger.date), desc(ledger.id));

      return results.map(row => {
          let entityName: string | null = null;
          const entityType = row.ea.entityType;
          const entityId = row.ea.entityId;

          if (entityType === 'employer' && row.employer) {
            entityName = row.employer.name;
          } else if (entityType === 'trustProvider' && row.trustProvider) {
            entityName = row.trustProvider.name;
          } else if (entityType === 'worker') {
            if (row.workerContact) {
              entityName = `${row.workerContact.given} ${row.workerContact.family}`;
            } else if (row.workerSiriusId) {
              entityName = `Worker #${row.workerSiriusId}`;
            }
          } else {
            entityName = `${entityType} ${entityId.substring(0, 8)}`;
          }

          return {
            ...row.entry,
            entityType,
            entityId,
            entityName,
            eaAccountId: row.ea.accountId,
          };
        });
    },

    async getByAccountId(accountId: string): Promise<LedgerEntryWithDetails[]> {
      return this.getTransactions({ accountId });
    },

    async create(insertEntry: InsertLedger): Promise<Ledger> {
      const [entry] = await db.insert(ledger)
        .values(insertEntry as any)
        .returning();
      return entry;
    },

    async update(id: string, entryUpdate: Partial<InsertLedger>): Promise<Ledger | undefined> {
      const [entry] = await db.update(ledger)
        .set(entryUpdate as any)
        .where(eq(ledger.id, id))
        .returning();
      return entry || undefined;
    },

    async delete(id: string): Promise<boolean> {
      const result = await db.delete(ledger)
        .where(eq(ledger.id, id));
      return result.rowCount ? result.rowCount > 0 : false;
    },

    async deleteByReference(referenceType: string, referenceId: string): Promise<number> {
      const result = await db.delete(ledger)
        .where(and(
          eq(ledger.referenceType, referenceType),
          eq(ledger.referenceId, referenceId)
        ));
      return result.rowCount || 0;
    }
  };
}

/**
 * Allocate a payment to the ledger.
 * 
 * This function manages the allocation of a payment to the general ledger:
 * - If payment status is "cleared", creates a ledger entry reflecting the payment
 * - If payment status is anything else, deletes any existing ledger entries for this payment
 * 
 * This function MUST be called every time a payment is saved (created or updated).
 * 
 * @param payment - The payment to allocate
 * @param ledgerStorage - The ledger storage instance to use for operations
 * @returns Promise that resolves when allocation is complete
 */
export async function allocatePayment(
  payment: LedgerPayment,
  ledgerStorage: LedgerStorage
): Promise<void> {
  // Always delete existing allocations first to avoid duplicates
  await ledgerStorage.entries.deleteByReference('payment', payment.id);

  // If payment is cleared, create a new ledger entry
  // Note: The amount is negated because a payment received (+$500) should reduce the liability (-$500)
  if (payment.status === 'cleared') {
    await ledgerStorage.entries.create({
      amount: (-parseFloat(payment.amount)).toString(),
      eaId: payment.ledgerEaId,
      referenceType: 'payment',
      referenceId: payment.id,
      date: payment.dateCleared || null,
      memo: payment.memo || null,
      data: payment.details || null
    });

    // Mark payment as allocated
    await ledgerStorage.payments.update(payment.id, { allocated: true });
  } else {
    // Mark payment as not allocated
    await ledgerStorage.payments.update(payment.id, { allocated: false });
  }
}

export function createLedgerStorage(
  accountLoggingConfig?: StorageLoggingConfig<LedgerAccountStorage>,
  stripePaymentMethodLoggingConfig?: StorageLoggingConfig<StripePaymentMethodStorage>,
  eaLoggingConfig?: StorageLoggingConfig<LedgerEaStorage>,
  paymentLoggingConfig?: StorageLoggingConfig<LedgerPaymentStorage>,
  entryLoggingConfig?: StorageLoggingConfig<LedgerEntryStorage>
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

  const entryStorage = entryLoggingConfig
    ? withStorageLogging(createLedgerEntryStorage(), entryLoggingConfig)
    : createLedgerEntryStorage();
  
  return {
    accounts: accountStorage,
    stripePaymentMethods: stripePaymentMethodStorage,
    ea: eaStorage,
    payments: paymentStorage,
    entries: entryStorage
  };
}
