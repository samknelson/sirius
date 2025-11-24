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
import { eq, and, desc, or, isNull, asc, sql as sqlRaw, sum, min, max, count, inArray } from "drizzle-orm";
import { alias as pgAlias } from "drizzle-orm/pg-core";
import { withStorageLogging, type StorageLoggingConfig } from "./middleware/logging";

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
  eaAccountName: string | null;
  referenceName: string | null;
}

export interface InvoiceSummary {
  month: number;
  year: number;
  totalAmount: string;
  entryCount: number;
  incomingBalance: string;
  invoiceBalance: string;
  outgoingBalance: string;
}

export interface InvoiceDetails extends InvoiceSummary {
  entries: LedgerEntryWithDetails[];
  invoiceHeader?: string | null;
  invoiceFooter?: string | null;
}

export interface LedgerInvoiceStorage {
  listForEa(eaId: string): Promise<InvoiceSummary[]>;
  getDetails(eaId: string, month: number, year: number): Promise<InvoiceDetails | undefined>;
}

export interface AccountParticipant {
  eaId: string;
  entityType: string;
  entityId: string;
  entityName: string | null;
  totalBalance: number;
  firstEntryDate: Date | null;
  lastEntryDate: Date | null;
  entryCount: number;
}

export interface LedgerAccountStorage {
  getAll(): Promise<LedgerAccount[]>;
  get(id: string): Promise<LedgerAccount | undefined>;
  create(account: InsertLedgerAccount): Promise<LedgerAccount>;
  update(id: string, account: Partial<InsertLedgerAccount>): Promise<LedgerAccount | undefined>;
  delete(id: string): Promise<boolean>;
  getParticipants(accountId: string, limit: number, offset: number): Promise<{ data: AccountParticipant[]; total: number }>;
}

export interface LedgerStorage {
  accounts: LedgerAccountStorage;
  stripePaymentMethods: StripePaymentMethodStorage;
  ea: LedgerEaStorage;
  payments: LedgerPaymentStorage;
  entries: LedgerEntryStorage;
  invoices: LedgerInvoiceStorage;
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
    },

    async getParticipants(accountId: string, limit: number, offset: number): Promise<{ data: AccountParticipant[]; total: number }> {
      // Build aggregation subquery with entity name joins for sorting
      const participantAgg = db
        .select({
          eaId: ledgerEa.id,
          entityType: ledgerEa.entityType,
          entityId: ledgerEa.entityId,
          totalBalance: sum(ledger.amount).as('totalBalance'),
          firstEntryDate: min(ledger.date).as('firstEntryDate'),
          lastEntryDate: max(ledger.date).as('lastEntryDate'),
          entryCount: count(ledger.id).as('entryCount'),
          employerName: employers.name,
          workerGiven: contacts.given,
          workerFamily: contacts.family,
          providerName: trustProviders.name,
        })
        .from(ledgerEa)
        .innerJoin(ledger, eq(ledger.eaId, ledgerEa.id))
        .leftJoin(employers, and(
          eq(ledgerEa.entityType, 'employer'),
          eq(ledgerEa.entityId, employers.id)
        ))
        .leftJoin(workers, and(
          eq(ledgerEa.entityType, 'worker'),
          eq(ledgerEa.entityId, workers.id)
        ))
        .leftJoin(contacts, eq(workers.contactId, contacts.id))
        .leftJoin(trustProviders, and(
          eq(ledgerEa.entityType, 'trust_provider'),
          eq(ledgerEa.entityId, trustProviders.id)
        ))
        .where(eq(ledgerEa.accountId, accountId))
        .groupBy(
          ledgerEa.id,
          ledgerEa.entityType,
          ledgerEa.entityId,
          employers.name,
          contacts.given,
          contacts.family,
          trustProviders.name
        )
        .as('participantAgg');

      // Get total count of EAs with entries
      const [totalRow] = await db
        .select({ total: sqlRaw<number>`COUNT(DISTINCT ${ledgerEa.id})` })
        .from(ledgerEa)
        .innerJoin(ledger, eq(ledger.eaId, ledgerEa.id))
        .where(eq(ledgerEa.accountId, accountId));
      
      const total = totalRow?.total || 0;

      // Select from subquery with alphabetical ordering by entity name
      const participants = await db
        .select({
          eaId: participantAgg.eaId,
          entityType: participantAgg.entityType,
          entityId: participantAgg.entityId,
          totalBalance: participantAgg.totalBalance,
          firstEntryDate: participantAgg.firstEntryDate,
          lastEntryDate: participantAgg.lastEntryDate,
          entryCount: participantAgg.entryCount,
          employerName: participantAgg.employerName,
          workerGiven: participantAgg.workerGiven,
          workerFamily: participantAgg.workerFamily,
          providerName: participantAgg.providerName,
        })
        .from(participantAgg)
        .orderBy(
          asc(sqlRaw`COALESCE(
            ${participantAgg.employerName},
            ${participantAgg.workerGiven} || ' ' || ${participantAgg.workerFamily},
            ${participantAgg.providerName},
            ''
          )`)
        )
        .limit(limit)
        .offset(offset);

      // Map to final format with entity names already resolved
      const enrichedParticipants = participants.map(p => {
        let entityName: string | null = null;
        
        if (p.entityType === 'employer') {
          entityName = p.employerName || null;
        } else if (p.entityType === 'worker') {
          entityName = p.workerGiven && p.workerFamily 
            ? `${p.workerGiven} ${p.workerFamily}` 
            : null;
        } else if (p.entityType === 'trust_provider') {
          entityName = p.providerName || null;
        }

        return {
          eaId: p.eaId,
          entityType: p.entityType,
          entityId: p.entityId,
          entityName,
          totalBalance: Number(p.totalBalance ?? 0),
          firstEntryDate: p.firstEntryDate ?? null,
          lastEntryDate: p.lastEntryDate ?? null,
          entryCount: Number(p.entryCount ?? 0),
        };
      });

      return { data: enrichedParticipants, total };
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
      const refEmployers = pgAlias(employers, 'ref_employers');
      const refTrustProviders = pgAlias(trustProviders, 'ref_trust_providers');
      const refWorkers = pgAlias(workers, 'ref_workers');
      const refContacts = pgAlias(contacts, 'ref_contacts');

      const query = db
        .select({
          entry: ledger,
          ea: ledgerEa,
          account: ledgerAccounts,
          employer: employers,
          trustProvider: trustProviders,
          workerSiriusId: workers.siriusId,
          workerContact: contacts,
          payment: ledgerPayments,
          refEmployer: refEmployers,
          refTrustProvider: refTrustProviders,
          refWorkerSiriusId: refWorkers.siriusId,
          refWorkerContact: refContacts,
        })
        .from(ledger)
        .innerJoin(ledgerEa, eq(ledger.eaId, ledgerEa.id))
        .innerJoin(ledgerAccounts, eq(ledgerEa.accountId, ledgerAccounts.id))
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
        )
        .leftJoin(
          ledgerPayments,
          and(
            eq(ledger.referenceType, 'payment'),
            eq(ledger.referenceId, ledgerPayments.id)
          )
        )
        .leftJoin(
          refEmployers,
          and(
            eq(ledger.referenceType, 'employer'),
            eq(ledger.referenceId, refEmployers.id)
          )
        )
        .leftJoin(
          refTrustProviders,
          and(
            eq(ledger.referenceType, 'trustProvider'),
            eq(ledger.referenceId, refTrustProviders.id)
          )
        )
        .leftJoin(
          refWorkers,
          and(
            eq(ledger.referenceType, 'worker'),
            eq(ledger.referenceId, refWorkers.id)
          )
        )
        .leftJoin(
          refContacts,
          and(
            eq(ledger.referenceType, 'worker'),
            eq(refWorkers.contactId, refContacts.id)
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

          let referenceName: string | null = null;
          if (row.entry.referenceType === 'payment' && row.payment) {
            const amount = parseFloat(row.payment.amount).toFixed(2);
            if (row.payment.memo) {
              referenceName = `Payment: $${amount} - ${row.payment.memo}`;
            } else {
              referenceName = `Payment: $${amount}`;
            }
          } else if (row.entry.referenceType === 'employer' && row.refEmployer) {
            referenceName = `Employer: ${row.refEmployer.name}`;
          } else if (row.entry.referenceType === 'trustProvider' && row.refTrustProvider) {
            referenceName = `Trust Provider: ${row.refTrustProvider.name}`;
          } else if (row.entry.referenceType === 'worker') {
            if (row.refWorkerContact) {
              referenceName = `Worker: ${row.refWorkerContact.given} ${row.refWorkerContact.family}`;
            } else if (row.refWorkerSiriusId) {
              referenceName = `Worker #${row.refWorkerSiriusId}`;
            } else {
              referenceName = `Worker (${row.entry.referenceId.substring(0, 8)}...)`;
            }
          } else if (row.entry.referenceType && row.entry.referenceId) {
            const capitalizedType = row.entry.referenceType.charAt(0).toUpperCase() + row.entry.referenceType.slice(1);
            referenceName = `${capitalizedType} (${row.entry.referenceId.substring(0, 8)}...)`;
          }

          return {
            ...row.entry,
            entityType,
            entityId,
            entityName,
            eaAccountId: row.ea.accountId,
            eaAccountName: row.account?.name || null,
            referenceName,
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

// Cents-based arithmetic helpers for precise decimal calculations
function toCents(amount: string): bigint {
  const num = parseFloat(amount);
  return BigInt(Math.round(num * 100));
}

function fromCents(cents: bigint): string {
  const dollars = Number(cents) / 100;
  return dollars.toFixed(2);
}

// Build invoices with running balances for an EA
type SimpleLedgerEntry = { id: string; amount: string; date: Date | null };
interface InvoiceBucket {
  month: number;
  year: number;
  entries: SimpleLedgerEntry[];
  incomingBalanceCents: bigint;
}

function buildInvoicesForEa(entries: SimpleLedgerEntry[]): Map<string, InvoiceBucket> {
  const invoiceMap = new Map<string, InvoiceBucket>();
  
  // Sort entries by date (nulls last), then by id for deterministic ordering
  const sortedEntries = [...entries].sort((a, b) => {
    if (!a.date && !b.date) return a.id.localeCompare(b.id);
    if (!a.date) return 1;
    if (!b.date) return -1;
    const dateCompare = a.date.getTime() - b.date.getTime();
    if (dateCompare !== 0) return dateCompare;
    return a.id.localeCompare(b.id);
  });

  let runningBalanceCents = BigInt(0);

  for (const entry of sortedEntries) {
    // Skip null-dated entries (can't be assigned to a month)
    if (!entry.date) continue;

    const date = new Date(entry.date);
    const month = date.getMonth() + 1; // 1-12
    const year = date.getFullYear();
    const key = `${year}-${month}`;

    // Create bucket if it doesn't exist
    if (!invoiceMap.has(key)) {
      invoiceMap.set(key, {
        month,
        year,
        entries: [],
        incomingBalanceCents: runningBalanceCents
      });
    }

    // Add entry to bucket
    const bucket = invoiceMap.get(key)!;
    bucket.entries.push(entry);

    // Update running balance
    runningBalanceCents += toCents(entry.amount);
  }

  return invoiceMap;
}

function createLedgerInvoiceStorage(): LedgerInvoiceStorage {
  return {
    async listForEa(eaId: string): Promise<InvoiceSummary[]> {
      // Get all ledger entries for this EA
      const entries = await db.select({
        id: ledger.id,
        amount: ledger.amount,
        date: ledger.date,
      })
      .from(ledger)
      .where(eq(ledger.eaId, eaId))
      .orderBy(asc(ledger.date));

      if (entries.length === 0) {
        return [];
      }

      // Build invoices with running balances
      const invoiceMap = buildInvoicesForEa(entries);

      // Convert to summaries
      const summaries: InvoiceSummary[] = [];
      for (const bucket of Array.from(invoiceMap.values())) {
        const invoiceBalanceCents = bucket.entries.reduce(
          (sum: bigint, e: SimpleLedgerEntry) => sum + toCents(e.amount),
          BigInt(0)
        );
        const outgoingBalanceCents = bucket.incomingBalanceCents + invoiceBalanceCents;

        summaries.push({
          month: bucket.month,
          year: bucket.year,
          totalAmount: fromCents(invoiceBalanceCents),
          entryCount: bucket.entries.length,
          incomingBalance: fromCents(bucket.incomingBalanceCents),
          invoiceBalance: fromCents(invoiceBalanceCents),
          outgoingBalance: fromCents(outgoingBalanceCents)
        });
      }

      // Sort by year desc, month desc (most recent first)
      summaries.sort((a, b) => {
        if (a.year !== b.year) return b.year - a.year;
        return b.month - a.month;
      });

      return summaries;
    },

    async getDetails(eaId: string, month: number, year: number): Promise<InvoiceDetails | undefined> {
      // Get EA to fetch accountId
      const ea = await db.select().from(ledgerEa).where(eq(ledgerEa.id, eaId)).limit(1);
      if (ea.length === 0) {
        return undefined;
      }

      // Get account to fetch invoice header/footer
      const account = await db.select().from(ledgerAccounts).where(eq(ledgerAccounts.id, ea[0].accountId)).limit(1);
      const accountData = (account.length > 0 && account[0]?.data) 
        ? account[0].data as { invoiceHeader?: string; invoiceFooter?: string } 
        : null;

      // Get all ledger entries for this EA (need all for running balance)
      const simpleEntries = await db.select({
        id: ledger.id,
        amount: ledger.amount,
        date: ledger.date,
      })
      .from(ledger)
      .where(eq(ledger.eaId, eaId))
      .orderBy(asc(ledger.date));

      if (simpleEntries.length === 0) {
        return undefined;
      }

      // Build invoices with running balances
      const invoiceMap = buildInvoicesForEa(simpleEntries);
      const key = `${year}-${month}`;
      const bucket = invoiceMap.get(key);

      if (!bucket) {
        return undefined;
      }

      // Get detailed entries for this month
      const entryStorage = createLedgerEntryStorage();
      const allDetailedEntries = await entryStorage.getTransactions({ eaId });
      
      // Filter to specific month/year and match the entry IDs
      const entryIds = new Set(bucket.entries.map(e => e.id));
      const monthEntries = allDetailedEntries.filter(entry => entryIds.has(entry.id));

      const invoiceBalanceCents = bucket.entries.reduce(
        (sum, e) => sum + toCents(e.amount),
        BigInt(0)
      );
      const outgoingBalanceCents = bucket.incomingBalanceCents + invoiceBalanceCents;

      return {
        month: bucket.month,
        year: bucket.year,
        totalAmount: fromCents(invoiceBalanceCents),
        entryCount: bucket.entries.length,
        incomingBalance: fromCents(bucket.incomingBalanceCents),
        invoiceBalance: fromCents(invoiceBalanceCents),
        outgoingBalance: fromCents(outgoingBalanceCents),
        entries: monthEntries,
        invoiceHeader: accountData?.invoiceHeader ?? null,
        invoiceFooter: accountData?.invoiceFooter ?? null,
      };
    }
  };
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

  const invoiceStorage = createLedgerInvoiceStorage();
  
  return {
    accounts: accountStorage,
    stripePaymentMethods: stripePaymentMethodStorage,
    ea: eaStorage,
    payments: paymentStorage,
    entries: entryStorage,
    invoices: invoiceStorage
  };
}
