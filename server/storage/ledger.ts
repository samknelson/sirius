import { createNoopValidator } from './utils/validation';
import { getClient } from './transaction-context';
import { db } from './db';
import { ledgerAccounts, ledgerStripePaymentMethods, ledgerEa, ledgerPayments, ledger, employers, workers, contacts, trustProviders, optionsLedgerPaymentType } from "@shared/schema";
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
import { formatAmount, getCurrency } from "@shared/currency";

/**
 * Stub validator - add validation logic here when needed
 */
export const validate = createNoopValidator();

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
  getByEntityAndAccount(entityType: string, entityId: string, accountId: string): Promise<SelectLedgerEa | undefined>;
  getOrCreate(entityType: string, entityId: string, accountId: string): Promise<SelectLedgerEa>;
  getBalance(id: string): Promise<string>;
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

export type TransactionFilter = 
  | { accountId: string } 
  | { eaId: string } 
  | { referenceType: string; referenceId: string };

export interface LedgerEntryFilter {
  chargePlugins?: string[];
  dateFrom?: Date;
  dateTo?: Date;
}

export interface LedgerEntryStorage {
  getAll(): Promise<Ledger[]>;
  get(id: string): Promise<Ledger | undefined>;
  getByEaId(eaId: string): Promise<Ledger[]>;
  getByReference(referenceType: string, referenceId: string): Promise<Ledger[]>;
  getByChargePluginKey(chargePlugin: string, chargePluginKey: string): Promise<Ledger | undefined>;
  getByReferenceAndConfig(referenceId: string, chargePluginConfigId: string): Promise<Ledger[]>;
  getByFilter(filter: LedgerEntryFilter): Promise<Ledger[]>;
  getTransactions(filter: TransactionFilter): Promise<LedgerEntryWithDetails[]>;
  getByAccountId(accountId: string): Promise<LedgerEntryWithDetails[]>;
  create(entry: InsertLedger): Promise<Ledger>;
  update(id: string, entry: Partial<InsertLedger>): Promise<Ledger | undefined>;
  delete(id: string): Promise<boolean>;
  deleteByReference(referenceType: string, referenceId: string): Promise<number>;
  deleteByChargePluginKey(chargePlugin: string, chargePluginKey: string): Promise<boolean>;
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
      const client = getClient();
      const results = await client.select().from(ledgerAccounts);
      return results;
    },

    async get(id: string): Promise<LedgerAccount | undefined> {
      const client = getClient();
      const [account] = await client.select().from(ledgerAccounts).where(eq(ledgerAccounts.id, id));
      return account || undefined;
    },

    async create(insertAccount: InsertLedgerAccount): Promise<LedgerAccount> {
      const client = getClient();
      const [account] = await client.insert(ledgerAccounts).values(insertAccount).returning();
      return account;
    },

    async update(id: string, accountUpdate: Partial<InsertLedgerAccount>): Promise<LedgerAccount | undefined> {
      const client = getClient();
      const [account] = await client.update(ledgerAccounts)
        .set(accountUpdate)
        .where(eq(ledgerAccounts.id, id))
        .returning();
      return account || undefined;
    },

    async delete(id: string): Promise<boolean> {
      const client = getClient();
      const result = await client.delete(ledgerAccounts).where(eq(ledgerAccounts.id, id));
      return result.rowCount ? result.rowCount > 0 : false;
    },

    async getParticipants(accountId: string, limit: number, offset: number): Promise<{ data: AccountParticipant[]; total: number }> {
      const client = getClient();
      // First, get all participants with aggregated data (no pagination yet)
      const allParticipants = await client
        .select({
          eaId: ledgerEa.id,
          entityType: ledgerEa.entityType,
          entityId: ledgerEa.entityId,
          totalBalance: sum(ledger.amount).as('totalBalance'),
          firstEntryDate: min(ledger.date).as('firstEntryDate'),
          lastEntryDate: max(ledger.date).as('lastEntryDate'),
          entryCount: count(ledger.id).as('entryCount'),
        })
        .from(ledgerEa)
        .innerJoin(ledger, eq(ledger.eaId, ledgerEa.id))
        .where(eq(ledgerEa.accountId, accountId))
        .groupBy(ledgerEa.id, ledgerEa.entityType, ledgerEa.entityId);

      const total = allParticipants.length;

      // Batch entity name lookups for ALL participants
      const employerIds = allParticipants.filter(p => p.entityType === 'employer').map(p => p.entityId);
      const workerIds = allParticipants.filter(p => p.entityType === 'worker').map(p => p.entityId);
      const providerIds = allParticipants.filter(p => p.entityType === 'trust_provider').map(p => p.entityId);

      // Fetch all employers
      const employersData = employerIds.length > 0
        ? await client.select({ id: employers.id, name: employers.name })
            .from(employers)
            .where(inArray(employers.id, employerIds))
        : [];
      const employerMap = new Map(employersData.map(e => [e.id, e.name]));

      // Fetch all workers and their contacts
      const workersData = workerIds.length > 0
        ? await client.select({ 
            id: workers.id, 
            contactId: workers.contactId,
            given: contacts.given,
            family: contacts.family 
          })
            .from(workers)
            .innerJoin(contacts, eq(contacts.id, workers.contactId))
            .where(inArray(workers.id, workerIds))
        : [];
      const workerMap = new Map(workersData.map(w => [w.id, `${w.given} ${w.family}`]));

      // Fetch all trust providers
      const providersData = providerIds.length > 0
        ? await client.select({ id: trustProviders.id, name: trustProviders.name })
            .from(trustProviders)
            .where(inArray(trustProviders.id, providerIds))
        : [];
      const providerMap = new Map(providersData.map(p => [p.id, p.name]));

      // Enrich with entity names
      const enrichedParticipants = allParticipants.map(p => {
        let entityName: string | null = null;
        
        if (p.entityType === 'employer') {
          entityName = employerMap.get(p.entityId) || null;
        } else if (p.entityType === 'worker') {
          entityName = workerMap.get(p.entityId) || null;
        } else if (p.entityType === 'trust_provider') {
          entityName = providerMap.get(p.entityId) || null;
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

      // Sort alphabetically by entity name
      enrichedParticipants.sort((a, b) => {
        const nameA = (a.entityName || '').toLowerCase();
        const nameB = (b.entityName || '').toLowerCase();
        return nameA.localeCompare(nameB);
      });

      // Apply pagination after sorting
      const paginatedParticipants = enrichedParticipants.slice(offset, offset + limit);

      return { data: paginatedParticipants, total };
    }
  };
}

export function createStripePaymentMethodStorage(): StripePaymentMethodStorage {
  return {
    async getAll(): Promise<LedgerStripePaymentMethod[]> {
      const client = getClient();
      return await client.select().from(ledgerStripePaymentMethods)
        .orderBy(desc(ledgerStripePaymentMethods.createdAt));
    },

    async get(id: string): Promise<LedgerStripePaymentMethod | undefined> {
      const client = getClient();
      const [paymentMethod] = await client.select().from(ledgerStripePaymentMethods)
        .where(eq(ledgerStripePaymentMethods.id, id));
      return paymentMethod || undefined;
    },

    async getByEntity(entityType: string, entityId: string): Promise<LedgerStripePaymentMethod[]> {
      const client = getClient();
      return await client.select().from(ledgerStripePaymentMethods)
        .where(and(
          eq(ledgerStripePaymentMethods.entityType, entityType),
          eq(ledgerStripePaymentMethods.entityId, entityId)
        ))
        .orderBy(desc(ledgerStripePaymentMethods.isDefault), desc(ledgerStripePaymentMethods.createdAt));
    },

    async create(insertPaymentMethod: InsertLedgerStripePaymentMethod): Promise<LedgerStripePaymentMethod> {
      const client = getClient();
      const [paymentMethod] = await client.insert(ledgerStripePaymentMethods)
        .values(insertPaymentMethod)
        .returning();
      return paymentMethod;
    },

    async update(id: string, paymentMethodUpdate: Partial<InsertLedgerStripePaymentMethod>): Promise<LedgerStripePaymentMethod | undefined> {
      const client = getClient();
      const [paymentMethod] = await client.update(ledgerStripePaymentMethods)
        .set(paymentMethodUpdate)
        .where(eq(ledgerStripePaymentMethods.id, id))
        .returning();
      return paymentMethod || undefined;
    },

    async delete(id: string): Promise<boolean> {
      const client = getClient();
      const result = await client.delete(ledgerStripePaymentMethods)
        .where(eq(ledgerStripePaymentMethods.id, id))
        .returning();
      return result.length > 0;
    },

    async setAsDefault(paymentMethodId: string, entityType: string, entityId: string): Promise<LedgerStripePaymentMethod | undefined> {
      const client = getClient();
      await client
        .update(ledgerStripePaymentMethods)
        .set({ isDefault: false })
        .where(and(
          eq(ledgerStripePaymentMethods.entityType, entityType),
          eq(ledgerStripePaymentMethods.entityId, entityId)
        ));
      
      const [paymentMethod] = await client
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
      const client = getClient();
      return await client.select().from(ledgerEa);
    },

    async get(id: string): Promise<SelectLedgerEa | undefined> {
      const client = getClient();
      const [entry] = await client.select().from(ledgerEa).where(eq(ledgerEa.id, id));
      return entry || undefined;
    },

    async getByEntity(entityType: string, entityId: string): Promise<SelectLedgerEa[]> {
      const client = getClient();
      return await client.select().from(ledgerEa)
        .where(and(
          eq(ledgerEa.entityType, entityType),
          eq(ledgerEa.entityId, entityId)
        ));
    },

    async getByEntityAndAccount(entityType: string, entityId: string, accountId: string): Promise<SelectLedgerEa | undefined> {
      const client = getClient();
      const [entry] = await client.select().from(ledgerEa)
        .where(and(
          eq(ledgerEa.entityType, entityType),
          eq(ledgerEa.entityId, entityId),
          eq(ledgerEa.accountId, accountId)
        ));
      return entry || undefined;
    },

    async getOrCreate(entityType: string, entityId: string, accountId: string): Promise<SelectLedgerEa> {
      // Use a transaction with conflict handling to prevent race conditions
      return await db.transaction(async (tx) => {
        // First, try to find existing EA entry
        const [existingEa] = await tx
          .select()
          .from(ledgerEa)
          .where(
            and(
              eq(ledgerEa.accountId, accountId),
              eq(ledgerEa.entityType, entityType),
              eq(ledgerEa.entityId, entityId)
            )
          )
          .limit(1);

        if (existingEa) {
          return existingEa;
        }

        // Try to create new EA entry with conflict handling
        const insertResult = await tx
          .insert(ledgerEa)
          .values({
            accountId,
            entityType,
            entityId,
          })
          .onConflictDoNothing()
          .returning();

        if (insertResult.length > 0) {
          return insertResult[0];
        }

        // Conflict occurred, look up the existing entry
        const [conflictedEa] = await tx
          .select()
          .from(ledgerEa)
          .where(
            and(
              eq(ledgerEa.accountId, accountId),
              eq(ledgerEa.entityType, entityType),
              eq(ledgerEa.entityId, entityId)
            )
          )
          .limit(1);

        if (!conflictedEa) {
          throw new Error("Failed to find or create EA entry after conflict");
        }

        return conflictedEa;
      });
    },

    async getBalance(id: string): Promise<string> {
      const client = getClient();
      const result = await client
        .select({ totalBalance: sum(ledger.amount) })
        .from(ledger)
        .where(eq(ledger.eaId, id));
      
      const balance = result[0]?.totalBalance;
      return balance ? String(balance) : "0.00";
    },

    async create(insertEntry: InsertLedgerEa): Promise<SelectLedgerEa> {
      const client = getClient();
      const [entry] = await client.insert(ledgerEa).values(insertEntry).returning();
      return entry;
    },

    async update(id: string, entryUpdate: Partial<InsertLedgerEa>): Promise<SelectLedgerEa | undefined> {
      const client = getClient();
      const [entry] = await client.update(ledgerEa)
        .set(entryUpdate)
        .where(eq(ledgerEa.id, id))
        .returning();
      return entry || undefined;
    },

    async delete(id: string): Promise<boolean> {
      const client = getClient();
      const result = await client.delete(ledgerEa).where(eq(ledgerEa.id, id));
      return result.rowCount ? result.rowCount > 0 : false;
    }
  };
}

export function createLedgerPaymentStorage(): LedgerPaymentStorage {
  return {
    async getAll(): Promise<LedgerPayment[]> {
      const client = getClient();
      return await client.select().from(ledgerPayments)
        .orderBy(desc(ledgerPayments.id));
    },

    async get(id: string): Promise<LedgerPayment | undefined> {
      const client = getClient();
      const [payment] = await client.select().from(ledgerPayments)
        .where(eq(ledgerPayments.id, id));
      return payment || undefined;
    },

    async getByLedgerEaId(ledgerEaId: string): Promise<LedgerPayment[]> {
      const client = getClient();
      return await client.select().from(ledgerPayments)
        .where(eq(ledgerPayments.ledgerEaId, ledgerEaId))
        .orderBy(desc(ledgerPayments.id));
    },

    async getByAccountIdWithEntity(accountId: string): Promise<LedgerPaymentWithEntity[]> {
      const client = getClient();
      const results = await client
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
      const client = getClient();
      const [countResult] = await client
        .select({
          count: db.$count(ledgerPayments.id)
        })
        .from(ledgerPayments)
        .innerJoin(ledgerEa, eq(ledgerPayments.ledgerEaId, ledgerEa.id))
        .where(eq(ledgerEa.accountId, accountId));

      const total = Number(countResult?.count || 0);

      const results = await client
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
      const client = getClient();
      // Validate currency match between payment type and account
      const [ea] = await client.select().from(ledgerEa).where(eq(ledgerEa.id, insertPayment.ledgerEaId));
      if (!ea) {
        throw new Error("Account entry not found");
      }
      
      const [account] = await client.select().from(ledgerAccounts).where(eq(ledgerAccounts.id, ea.accountId));
      if (!account) {
        throw new Error("Account not found");
      }
      
      const [paymentType] = await client.select().from(optionsLedgerPaymentType).where(eq(optionsLedgerPaymentType.id, insertPayment.paymentType));
      if (!paymentType) {
        throw new Error("Payment type not found");
      }
      
      if (paymentType.currencyCode !== account.currencyCode) {
        throw new Error(`Currency mismatch: Payment type "${paymentType.name}" uses ${paymentType.currencyCode} but account "${account.name}" uses ${account.currencyCode}`);
      }
      
      const [payment] = await client.insert(ledgerPayments)
        .values(insertPayment as any)
        .returning();
      return payment;
    },

    async update(id: string, paymentUpdate: Partial<InsertLedgerPayment>): Promise<LedgerPayment | undefined> {
      const client = getClient();
      // If payment type is being changed, validate currency match
      if (paymentUpdate.paymentType) {
        const [existingPayment] = await client.select().from(ledgerPayments).where(eq(ledgerPayments.id, id));
        if (!existingPayment) {
          return undefined;
        }
        
        const [ea] = await client.select().from(ledgerEa).where(eq(ledgerEa.id, existingPayment.ledgerEaId));
        if (!ea) {
          throw new Error("Account entry not found");
        }
        
        const [account] = await client.select().from(ledgerAccounts).where(eq(ledgerAccounts.id, ea.accountId));
        if (!account) {
          throw new Error("Account not found");
        }
        
        const [paymentType] = await client.select().from(optionsLedgerPaymentType).where(eq(optionsLedgerPaymentType.id, paymentUpdate.paymentType));
        if (!paymentType) {
          throw new Error("Payment type not found");
        }
        
        if (paymentType.currencyCode !== account.currencyCode) {
          throw new Error(`Currency mismatch: Payment type "${paymentType.name}" uses ${paymentType.currencyCode} but account "${account.name}" uses ${account.currencyCode}`);
        }
      }
      
      const [payment] = await client.update(ledgerPayments)
        .set(paymentUpdate as any)
        .where(eq(ledgerPayments.id, id))
        .returning();
      return payment || undefined;
    },

    async delete(id: string): Promise<boolean> {
      const client = getClient();
      const result = await client.delete(ledgerPayments)
        .where(eq(ledgerPayments.id, id));
      return result.rowCount ? result.rowCount > 0 : false;
    }
  };
}

export function createLedgerEntryStorage(): LedgerEntryStorage {
  return {
    async getAll(): Promise<Ledger[]> {
      const client = getClient();
      return await client.select().from(ledger);
    },

    async get(id: string): Promise<Ledger | undefined> {
      const client = getClient();
      const [entry] = await client.select().from(ledger).where(eq(ledger.id, id));
      return entry || undefined;
    },

    async getByEaId(eaId: string): Promise<Ledger[]> {
      const client = getClient();
      return await client.select().from(ledger)
        .where(eq(ledger.eaId, eaId));
    },

    async getByReference(referenceType: string, referenceId: string): Promise<Ledger[]> {
      const client = getClient();
      return await client.select().from(ledger)
        .where(and(
          eq(ledger.referenceType, referenceType),
          eq(ledger.referenceId, referenceId)
        ));
    },

    async getTransactions(filter: TransactionFilter): Promise<LedgerEntryWithDetails[]> {
      const client = getClient();
      const refEmployers = pgAlias(employers, 'ref_employers');
      const refTrustProviders = pgAlias(trustProviders, 'ref_trust_providers');
      const refWorkers = pgAlias(workers, 'ref_workers');
      const refContacts = pgAlias(contacts, 'ref_contacts');

      const query = client
        .select({
          entry: ledger,
          ea: ledgerEa,
          account: ledgerAccounts,
          employer: employers,
          trustProvider: trustProviders,
          workerSiriusId: workers.siriusId,
          workerContact: contacts,
          payment: ledgerPayments,
          paymentType: optionsLedgerPaymentType,
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
          optionsLedgerPaymentType,
          eq(ledgerPayments.paymentType, optionsLedgerPaymentType.id)
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

      let whereClause;
      if ('accountId' in filter) {
        whereClause = eq(ledgerEa.accountId, filter.accountId);
      } else if ('eaId' in filter) {
        whereClause = eq(ledger.eaId, filter.eaId);
      } else {
        whereClause = and(
          eq(ledger.referenceType, filter.referenceType),
          eq(ledger.referenceId, filter.referenceId)
        );
      }

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
            const paymentTypeName = row.paymentType?.name || 'Payment';
            const currencyCode = row.paymentType?.currencyCode || 'USD';
            const currency = getCurrency(currencyCode);
            const currencyLabel = currency?.label || currencyCode;
            const formattedAmount = formatAmount(parseFloat(row.payment.amount), currencyCode);
            
            if (row.payment.memo) {
              referenceName = `${currencyLabel} Adjustment: ${formattedAmount} - ${row.payment.memo}`;
            } else {
              referenceName = `${currencyLabel} Adjustment: ${formattedAmount}`;
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
      const client = getClient();
      const [entry] = await client.insert(ledger)
        .values(insertEntry as any)
        .returning();
      return entry;
    },

    async update(id: string, entryUpdate: Partial<InsertLedger>): Promise<Ledger | undefined> {
      const client = getClient();
      const [entry] = await client.update(ledger)
        .set(entryUpdate as any)
        .where(eq(ledger.id, id))
        .returning();
      return entry || undefined;
    },

    async delete(id: string): Promise<boolean> {
      const client = getClient();
      const result = await client.delete(ledger)
        .where(eq(ledger.id, id));
      return result.rowCount ? result.rowCount > 0 : false;
    },

    async deleteByReference(referenceType: string, referenceId: string): Promise<number> {
      const client = getClient();
      const result = await client.delete(ledger)
        .where(and(
          eq(ledger.referenceType, referenceType),
          eq(ledger.referenceId, referenceId)
        ));
      return result.rowCount || 0;
    },

    async getByChargePluginKey(chargePlugin: string, chargePluginKey: string): Promise<Ledger | undefined> {
      const client = getClient();
      const [entry] = await client.select()
        .from(ledger)
        .where(and(
          eq(ledger.chargePlugin, chargePlugin),
          eq(ledger.chargePluginKey, chargePluginKey)
        ))
        .limit(1);
      return entry || undefined;
    },

    async getByReferenceAndConfig(referenceId: string, chargePluginConfigId: string): Promise<Ledger[]> {
      const client = getClient();
      return await client.select()
        .from(ledger)
        .where(and(
          eq(ledger.referenceId, referenceId),
          eq(ledger.chargePluginConfigId, chargePluginConfigId)
        ));
    },

    async getByFilter(filter: LedgerEntryFilter): Promise<Ledger[]> {
      const client = getClient();
      const conditions: any[] = [];

      if (filter.chargePlugins && filter.chargePlugins.length > 0) {
        conditions.push(inArray(ledger.chargePlugin, filter.chargePlugins));
      }

      if (filter.dateFrom) {
        conditions.push(sqlRaw`${ledger.date} >= ${filter.dateFrom}`);
      }

      if (filter.dateTo) {
        conditions.push(sqlRaw`${ledger.date} <= ${filter.dateTo}`);
      }

      const query = client.select().from(ledger);
      
      if (conditions.length > 0) {
        return await query.where(and(...conditions)).orderBy(desc(ledger.date));
      }

      return await query.orderBy(desc(ledger.date));
    },

    async deleteByChargePluginKey(chargePlugin: string, chargePluginKey: string): Promise<boolean> {
      const client = getClient();
      const result = await client.delete(ledger)
        .where(and(
          eq(ledger.chargePlugin, chargePlugin),
          eq(ledger.chargePluginKey, chargePluginKey)
        ));
      return result.rowCount ? result.rowCount > 0 : false;
    }
  };
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
      const client = getClient();
      // Get all ledger entries for this EA
      const entries = await client.select({
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
      const client = getClient();
      // Get EA to fetch accountId
      const ea = await client.select().from(ledgerEa).where(eq(ledgerEa.id, eaId)).limit(1);
      if (ea.length === 0) {
        return undefined;
      }

      // Get account to fetch invoice header/footer
      const account = await client.select().from(ledgerAccounts).where(eq(ledgerAccounts.id, ea[0].accountId)).limit(1);
      const accountData = (account.length > 0 && account[0]?.data) 
        ? account[0].data as { invoiceHeader?: string; invoiceFooter?: string } 
        : null;

      // Get all ledger entries for this EA (need all for running balance)
      const simpleEntries = await client.select({
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

/**
 * Logging configuration for ledger account storage operations
 * 
 * Logs all ledger account mutations with full argument capture and change tracking.
 */
export const ledgerAccountLoggingConfig: StorageLoggingConfig<LedgerAccountStorage> = {
  module: 'ledger.accounts',
  methods: {
    create: {
      enabled: true,
      getEntityId: (args, result) => result?.id || args[0]?.name || 'new account',
      after: async (args, result, storage) => {
        return result; // Capture created account
      }
    },
    update: {
      enabled: true,
      getEntityId: (args) => args[0], // Account ID
      before: async (args, storage) => {
        return await storage.get(args[0]); // Current state
      },
      after: async (args, result, storage) => {
        return result; // New state (diff auto-calculated)
      }
    },
    delete: {
      enabled: true,
      getEntityId: (args) => args[0], // Account ID
      before: async (args, storage) => {
        return await storage.get(args[0]); // Capture what's being deleted
      }
    }
  }
};

/**
 * Logging configuration for Stripe payment method storage operations
 * 
 * Logs all Stripe payment method mutations with full argument capture and change tracking.
 */
export const stripePaymentMethodLoggingConfig: StorageLoggingConfig<StripePaymentMethodStorage> = {
  module: 'ledger.stripePaymentMethods',
  methods: {
    create: {
      enabled: true,
      getEntityId: (args, result) => result?.id || 'new payment method',
      after: async (args, result, storage) => {
        return result; // Capture created payment method
      }
    },
    update: {
      enabled: true,
      getEntityId: (args) => args[0], // Payment method ID
      before: async (args, storage) => {
        return await storage.get(args[0]); // Current state
      },
      after: async (args, result, storage) => {
        return result; // New state (diff auto-calculated)
      }
    },
    delete: {
      enabled: true,
      getEntityId: (args) => args[0], // Payment method ID
      before: async (args, storage) => {
        return await storage.get(args[0]); // Capture what's being deleted
      }
    },
    setAsDefault: {
      enabled: true,
      getEntityId: (args) => args[0], // Payment method ID
      before: async (args, storage) => {
        return await storage.get(args[0]); // Current state
      },
      after: async (args, result, storage) => {
        return result; // New state (diff auto-calculated)
      }
    }
  }
};

/**
 * Helper to resolve worker ID from an EA
 */
async function getWorkerIdFromEaId(eaId: string): Promise<string | undefined> {
  const eaStorage = createLedgerEaStorage();
  const ea = await eaStorage.get(eaId);
  if (ea && ea.entityType === 'worker') {
    return ea.entityId;
  }
  return undefined;
}

/**
 * Helper to format a payment for logging display
 */
function formatPaymentForLog(payment: LedgerPayment | undefined): string {
  if (!payment) return 'payment';
  const amount = payment.amount ? `$${payment.amount}` : '';
  const memo = payment.memo ? ` - ${payment.memo}` : '';
  return amount ? `${amount} payment${memo}` : 'payment';
}

/**
 * Logging configuration for ledger payment storage operations
 * 
 * Logs all payment mutations with full argument capture and change tracking.
 * Links to worker entity when the payment's EA is associated with a worker.
 */
export const ledgerPaymentLoggingConfig: StorageLoggingConfig<LedgerPaymentStorage> = {
  module: 'ledger.payments',
  methods: {
    create: {
      enabled: true,
      getEntityId: (args, result) => formatPaymentForLog(result),
      getHostEntityId: async (args, result) => {
        if (result?.ledgerEaId) {
          return await getWorkerIdFromEaId(result.ledgerEaId);
        }
        return undefined;
      },
      after: async (args, result, storage) => {
        return result; // Capture created payment
      }
    },
    update: {
      enabled: true,
      getEntityId: (args, result, beforeState) => formatPaymentForLog(result || beforeState),
      getHostEntityId: async (args, result, beforeState) => {
        const eaId = result?.ledgerEaId || beforeState?.ledgerEaId;
        if (eaId) {
          return await getWorkerIdFromEaId(eaId);
        }
        return undefined;
      },
      before: async (args, storage) => {
        return await storage.get(args[0]); // Current state
      },
      after: async (args, result, storage) => {
        return result; // New state (diff auto-calculated)
      }
    },
    delete: {
      enabled: true,
      getEntityId: (args, result, beforeState) => formatPaymentForLog(beforeState),
      getHostEntityId: async (args, result, beforeState) => {
        if (beforeState?.ledgerEaId) {
          return await getWorkerIdFromEaId(beforeState.ledgerEaId);
        }
        return undefined;
      },
      before: async (args, storage) => {
        return await storage.get(args[0]); // Capture what's being deleted
      }
    }
  }
};
