import { createNoopValidator } from './utils/validation';
import { getClient } from './transaction-context';
import { logger } from "../logger";
import { ledgerAccounts, ledgerStripePaymentMethods, ledgerEa, ledgerPayments, ledger, employers, workers, contacts, trustProviders, optionsLedgerPaymentType } from "@shared/schema";
import { ledgerPaymentBatches, ledgerPaymentBatchAssignments } from "@shared/schema/ledger/payment-batch/schema";
import type { LedgerPaymentBatch, InsertLedgerPaymentBatch, LedgerPaymentBatchAssignment } from "@shared/schema/ledger/payment-batch/schema";
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
import { eq, and, desc, or, isNull, asc, sql as sqlRaw, sum, min, max, count, inArray, notInArray, gte, lte } from "drizzle-orm";
import { alias as pgAlias } from "drizzle-orm/pg-core";
import { defineLoggingConfig, withStorageLogging, type StorageLoggingConfig } from "./middleware/logging";
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

export type LedgerEaWithBalance = SelectLedgerEa & { balance: string };

export interface LedgerEaWithAccount {
  eaId: string;
  entityId: string;
  accountId: string;
  accountName: string | null;
}

export interface LedgerEaStorage {
  getAll(): Promise<SelectLedgerEa[]>;
  get(id: string): Promise<SelectLedgerEa | undefined>;
  getByEntity(entityType: string, entityId: string): Promise<SelectLedgerEa[]>;
  getByEntityIdsWithAccount(entityType: string, entityIds: string[]): Promise<LedgerEaWithAccount[]>;
  getByEntityWithBalance(entityType: string, entityId: string): Promise<LedgerEaWithBalance[]>;
  getByEntityAndAccount(entityType: string, entityId: string, accountId: string): Promise<SelectLedgerEa | undefined>;
  getOrCreate(entityType: string, entityId: string, accountId: string): Promise<SelectLedgerEa>;
  getBalance(id: string): Promise<string>;
  create(entry: InsertLedgerEa): Promise<SelectLedgerEa>;
  update(id: string, entry: Partial<InsertLedgerEa>): Promise<SelectLedgerEa | undefined>;
  delete(id: string): Promise<boolean>;
}

export interface LedgerPaymentTypeRow {
  id: string;
  name: string;
  category: string;
}

export interface LedgerPaymentTypeStorage {
  getByIds(ids: string[]): Promise<LedgerPaymentTypeRow[]>;
}

export interface LedgerPaymentStorage {
  getAll(): Promise<LedgerPayment[]>;
  get(id: string): Promise<LedgerPayment | undefined>;
  getByIds(ids: string[]): Promise<LedgerPayment[]>;
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
  getBalancesByEaIds(eaIds: string[]): Promise<Map<string, string>>;
  getBalancesByEntityAndAccount(entityType: string, entityIds: string[], accountIds: string[]): Promise<Array<{ entityId: string; accountId: string; total: string }>>;
  getMonthlyDeltasByEntityAndAccount(entityType: string, entityIds: string[], accountIds: string[], monthKeys: string[]): Promise<Array<{ entityId: string; ym: string; total: string }>>;
  getByReference(referenceType: string, referenceId: string): Promise<Ledger[]>;
  getByChargePluginKey(chargePlugin: string, chargePluginKey: string): Promise<Ledger | undefined>;
  getByReferenceAndConfig(referenceId: string, chargePluginConfigId: string): Promise<Ledger[]>;
  getByFilter(filter: LedgerEntryFilter): Promise<Ledger[]>;
  getTransactions(filter: TransactionFilter): Promise<LedgerEntryWithDetails[]>;
  getTransactionsPaginated(filter: TransactionFilter, limit: number, offset: number): Promise<{ data: LedgerEntryWithDetails[]; total: number }>;
  getByAccountId(accountId: string): Promise<LedgerEntryWithDetails[]>;
  getRawByAccountId(accountId: string): Promise<RawLedgerEntryWithEntity[]>;
  getByAccountIdPaginated(accountId: string, limit: number, offset: number): Promise<{ data: LedgerEntryWithDetails[]; total: number }>;
  create(entry: InsertLedger): Promise<Ledger>;
  update(id: string, entry: Partial<InsertLedger>): Promise<Ledger | undefined>;
  delete(id: string): Promise<boolean>;
  deleteByReference(referenceType: string, referenceId: string): Promise<number>;
  deleteByChargePluginKey(chargePlugin: string, chargePluginKey: string): Promise<boolean>;
  deleteOrphansByChargePluginAndKnownKeys(chargePlugin: string, accountId: string, knownKeys: Set<string>): Promise<number>;
  findByAccountEntityDatePlugin(accountId: string, entityId: string, date: Date, chargePlugin: string, chargePluginConfigId?: string, amount?: string): Promise<Ledger | undefined>;
  getLatestByAccountAndEntities(accountId: string, entityType: string, entityIds: string[]): Promise<Array<{ entityId: string; amount: string; date: string }>>;
}

export interface LedgerEntryWithDetails extends Ledger {
  entityType: string;
  entityId: string;
  entityName: string | null;
  eaAccountId: string;
  eaAccountName: string | null;
  referenceName: string | null;
}

export interface RawLedgerEntryWithEntity extends Ledger {
  entityType: string;
  entityId: string;
}

export interface InvoiceSummary {
  month: number;
  year: number;
  totalAmount: string;
  entryCount: number;
  incomingBalance: string;
  invoiceBalance: string;
  outgoingBalance: string;
  chargesSubtotal: string;
  adjustmentsSubtotal: string;
  paymentsReceivedSubtotal: string;
  paymentsAppliedSubtotal: string;
}

export interface InvoiceSectionEntry extends LedgerEntryWithDetails {
  paymentTypeCategory?: string | null;
  paymentStatementMonth?: number | null;
  paymentStatementYear?: number | null;
}

export interface InvoiceSection {
  entries: InvoiceSectionEntry[];
  subtotal: string;
}

export interface InvoiceDetails extends InvoiceSummary {
  entries: LedgerEntryWithDetails[];
  sections: {
    charges: InvoiceSection;
    adjustments: InvoiceSection;
    paymentsReceived: InvoiceSection;
    paymentsApplied: InvoiceSection;
  };
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

export interface LedgerPaymentBatchStorage {
  getAll(): Promise<LedgerPaymentBatch[]>;
  getByAccountId(accountId: string): Promise<LedgerPaymentBatch[]>;
  get(id: string): Promise<LedgerPaymentBatch | undefined>;
  create(batch: InsertLedgerPaymentBatch): Promise<LedgerPaymentBatch>;
  update(id: string, batch: Partial<InsertLedgerPaymentBatch>): Promise<LedgerPaymentBatch | undefined>;
  delete(id: string): Promise<boolean>;
}

export type LedgerPaymentWithAssignment = LedgerPaymentWithEntity & { _assignmentId: string };

export type AssignPaymentResult =
  | { kind: "created"; assignment: LedgerPaymentBatchAssignment }
  | { kind: "conflict"; assignment: LedgerPaymentBatchAssignment };

export interface LedgerPaymentBatchAssignmentStorage {
  getSummaryByBatchId(batchId: string): Promise<{ paymentsCount: number; paymentsTotal: string }>;
  getPaymentsByBatchId(batchId: string): Promise<LedgerPaymentWithAssignment[]>;
  assignPayment(batchId: string, paymentId: string): Promise<AssignPaymentResult>;
  unassign(batchId: string, paymentId: string): Promise<boolean>;
}

export interface LedgerStorage {
  accounts: LedgerAccountStorage;
  stripePaymentMethods: StripePaymentMethodStorage;
  ea: LedgerEaStorage;
  payments: LedgerPaymentStorage;
  paymentTypes: LedgerPaymentTypeStorage;
  entries: LedgerEntryStorage;
  invoices: LedgerInvoiceStorage;
  paymentBatches: LedgerPaymentBatchStorage;
  paymentBatchAssignments: LedgerPaymentBatchAssignmentStorage;
}

export function createLedgerPaymentTypeStorage(): LedgerPaymentTypeStorage {
  return {
    async getByIds(ids: string[]): Promise<LedgerPaymentTypeRow[]> {
      if (ids.length === 0) return [];
      const client = getClient();
      const rows = await client
        .select({
          id: optionsLedgerPaymentType.id,
          name: optionsLedgerPaymentType.name,
          category: optionsLedgerPaymentType.category,
        })
        .from(optionsLedgerPaymentType)
        .where(inArray(optionsLedgerPaymentType.id, ids));
      return rows.map(r => ({ id: r.id, name: r.name, category: r.category }));
    },
  };
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
      validate.validateOrThrow(insertAccount);
      const client = getClient();
      const [account] = await client.insert(ledgerAccounts).values(insertAccount).returning();
      return account;
    },

    async update(id: string, accountUpdate: Partial<InsertLedgerAccount>): Promise<LedgerAccount | undefined> {
      validate.validateOrThrow(id);
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
      validate.validateOrThrow(insertPaymentMethod);
      const client = getClient();
      const [paymentMethod] = await client.insert(ledgerStripePaymentMethods)
        .values(insertPaymentMethod)
        .returning();
      return paymentMethod;
    },

    async update(id: string, paymentMethodUpdate: Partial<InsertLedgerStripePaymentMethod>): Promise<LedgerStripePaymentMethod | undefined> {
      validate.validateOrThrow(id);
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

    async getByEntityIdsWithAccount(entityType: string, entityIds: string[]): Promise<LedgerEaWithAccount[]> {
      if (entityIds.length === 0) return [];
      const client = getClient();
      return await client
        .select({
          eaId: ledgerEa.id,
          entityId: ledgerEa.entityId,
          accountId: ledgerEa.accountId,
          accountName: ledgerAccounts.name,
        })
        .from(ledgerEa)
        .innerJoin(ledgerAccounts, eq(ledgerEa.accountId, ledgerAccounts.id))
        .where(and(
          eq(ledgerEa.entityType, entityType),
          inArray(ledgerEa.entityId, entityIds)
        ));
    },

    async getByEntityWithBalance(entityType: string, entityId: string): Promise<LedgerEaWithBalance[]> {
      const client = getClient();
      const entries = await client
        .select({
          id: ledgerEa.id,
          accountId: ledgerEa.accountId,
          entityType: ledgerEa.entityType,
          entityId: ledgerEa.entityId,
          data: ledgerEa.data,
          balance: sqlRaw<string>`COALESCE(SUM(${ledger.amount}), 0)::numeric(10,2)::text`,
        })
        .from(ledgerEa)
        .leftJoin(ledger, eq(ledger.eaId, ledgerEa.id))
        .where(and(
          eq(ledgerEa.entityType, entityType),
          eq(ledgerEa.entityId, entityId)
        ))
        .groupBy(ledgerEa.id, ledgerEa.accountId, ledgerEa.entityType, ledgerEa.entityId, ledgerEa.data);
      
      return entries.map(e => ({
        ...e,
        balance: e.balance || "0.00"
      }));
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
      const client = getClient();
      // Use a transaction with conflict handling to prevent race conditions
      return await client.transaction(async (tx: typeof client) => {
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
      validate.validateOrThrow(insertEntry);
      const client = getClient();
      const [entry] = await client.insert(ledgerEa).values(insertEntry).returning();
      return entry;
    },

    async update(id: string, entryUpdate: Partial<InsertLedgerEa>): Promise<SelectLedgerEa | undefined> {
      validate.validateOrThrow(id);
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

    async getByIds(ids: string[]): Promise<LedgerPayment[]> {
      if (ids.length === 0) return [];
      const client = getClient();
      return await client.select().from(ledgerPayments)
        .where(inArray(ledgerPayments.id, ids));
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
          count: count()
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
      validate.validateOrThrow(insertPayment);
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
      validate.validateOrThrow(id);
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
      const entriesResult = await client.delete(ledger)
        .where(and(
          eq(ledger.referenceType, "payment"),
          eq(ledger.referenceId, id)
        ));
      const deletedEntriesCount = entriesResult.rowCount || 0;
      if (deletedEntriesCount > 0) {
        logger.info("Deleted ledger entries when deleting payment", {
          service: "ledger-payments",
          paymentId: id,
          deletedCount: deletedEntriesCount,
        });
      }
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

    async getBalancesByEaIds(eaIds: string[]): Promise<Map<string, string>> {
      const balances = new Map<string, string>();
      if (eaIds.length === 0) return balances;
      const client = getClient();
      const rows = await client
        .select({
          eaId: ledger.eaId,
          total: sum(ledger.amount),
        })
        .from(ledger)
        .where(inArray(ledger.eaId, eaIds))
        .groupBy(ledger.eaId);
      for (const row of rows) {
        balances.set(row.eaId, row.total ?? "0.00");
      }
      return balances;
    },

    async getLatestByAccountAndEntities(accountId: string, entityType: string, entityIds: string[]): Promise<Array<{ entityId: string; amount: string; date: string }>> {
      if (entityIds.length === 0) return [];
      const client = getClient();
      const result = await client.execute(sqlRaw`
        SELECT DISTINCT ON (ea.entity_id)
          ea.entity_id,
          l.amount,
          l.date
        FROM ledger_ea ea
        INNER JOIN ledger l ON l.ea_id = ea.id
        WHERE ea.entity_type = ${entityType}
          AND ea.account_id = ${accountId}
          AND ea.entity_id = ANY(${entityIds})
        ORDER BY ea.entity_id, l.date DESC
      `);
      return (result.rows as Array<{ entity_id: string; amount: string; date: string }>).map(row => ({
        entityId: row.entity_id,
        amount: row.amount,
        date: row.date,
      }));
    },

    async getBalancesByEntityAndAccount(entityType: string, entityIds: string[], accountIds: string[]): Promise<Array<{ entityId: string; accountId: string; total: string }>> {
      if (entityIds.length === 0 || accountIds.length === 0) return [];
      const client = getClient();
      const rows = await client
        .select({
          entityId: ledgerEa.entityId,
          accountId: ledgerEa.accountId,
          total: sum(ledger.amount),
        })
        .from(ledgerEa)
        .leftJoin(ledger, eq(ledger.eaId, ledgerEa.id))
        .where(
          and(
            eq(ledgerEa.entityType, entityType),
            inArray(ledgerEa.entityId, entityIds),
            inArray(ledgerEa.accountId, accountIds),
          ),
        )
        .groupBy(ledgerEa.entityId, ledgerEa.accountId);
      return rows.map(r => ({
        entityId: r.entityId,
        accountId: r.accountId,
        total: r.total ? String(r.total) : "0.00",
      }));
    },

    async getMonthlyDeltasByEntityAndAccount(entityType: string, entityIds: string[], accountIds: string[], monthKeys: string[]): Promise<Array<{ entityId: string; ym: string; total: string }>> {
      if (entityIds.length === 0 || accountIds.length === 0 || monthKeys.length === 0) return [];
      const client = getClient();
      const ymExpr = sqlRaw<string>`substring(${ledger.statementYmd}, 1, 7)`;
      const rows = await client
        .select({
          entityId: ledgerEa.entityId,
          ym: ymExpr,
          total: sum(ledger.amount),
        })
        .from(ledger)
        .innerJoin(ledgerEa, eq(ledger.eaId, ledgerEa.id))
        .where(
          and(
            eq(ledgerEa.entityType, entityType),
            inArray(ledgerEa.entityId, entityIds),
            inArray(ledgerEa.accountId, accountIds),
            inArray(ymExpr, monthKeys),
          ),
        )
        .groupBy(ledgerEa.entityId, ymExpr);
      return rows.map(r => ({
        entityId: r.entityId,
        ym: r.ym,
        total: r.total ? String(r.total) : "0.00",
      }));
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
      try {
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
              referenceName = `${currencyLabel} Payment: ${formattedAmount} - ${row.payment.memo}`;
            } else {
              referenceName = `${currencyLabel} Payment: ${formattedAmount}`;
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
            } else if (row.entry.referenceId) {
              referenceName = `Worker (${row.entry.referenceId.substring(0, 8)}...)`;
            } else {
              referenceName = 'Worker';
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
      } catch (error) {
        logger.error("Error in getTransactions", {
          service: "ledger-storage",
          filter,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
        throw error;
      }
    },

    async getByAccountId(accountId: string): Promise<LedgerEntryWithDetails[]> {
      return this.getTransactions({ accountId });
    },

    async getTransactionsPaginated(filter: TransactionFilter, limit: number, offset: number): Promise<{ data: LedgerEntryWithDetails[]; total: number }> {
      const client = getClient();
      try {
        const refEmployers = pgAlias(employers, 'ref_employers');
        const refTrustProviders = pgAlias(trustProviders, 'ref_trust_providers');
        const refWorkers = pgAlias(workers, 'ref_workers');
        const refContacts = pgAlias(contacts, 'ref_contacts');

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

        const [countResult] = await client
          .select({ count: count() })
          .from(ledger)
          .innerJoin(ledgerEa, eq(ledger.eaId, ledgerEa.id))
          .where(whereClause);
        
        const total = countResult?.count || 0;

        const results = await client
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
          .leftJoin(employers, and(eq(ledgerEa.entityType, 'employer'), eq(ledgerEa.entityId, employers.id)))
          .leftJoin(trustProviders, and(eq(ledgerEa.entityType, 'trustProvider'), eq(ledgerEa.entityId, trustProviders.id)))
          .leftJoin(workers, and(eq(ledgerEa.entityType, 'worker'), eq(ledgerEa.entityId, workers.id)))
          .leftJoin(contacts, and(eq(ledgerEa.entityType, 'worker'), eq(workers.contactId, contacts.id)))
          .leftJoin(ledgerPayments, and(eq(ledger.referenceType, 'payment'), eq(ledger.referenceId, ledgerPayments.id)))
          .leftJoin(optionsLedgerPaymentType, eq(ledgerPayments.paymentType, optionsLedgerPaymentType.id))
          .leftJoin(refEmployers, and(eq(ledger.referenceType, 'employer'), eq(ledger.referenceId, refEmployers.id)))
          .leftJoin(refTrustProviders, and(eq(ledger.referenceType, 'trustProvider'), eq(ledger.referenceId, refTrustProviders.id)))
          .leftJoin(refWorkers, and(eq(ledger.referenceType, 'worker'), eq(ledger.referenceId, refWorkers.id)))
          .leftJoin(refContacts, and(eq(ledger.referenceType, 'worker'), eq(refWorkers.contactId, refContacts.id)))
          .where(whereClause)
          .orderBy(desc(ledger.date), desc(ledger.id))
          .limit(limit)
          .offset(offset);

        const data = results.map(row => {
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
            } else if (row.entry.referenceId) {
              referenceName = `Worker (${row.entry.referenceId.substring(0, 8)}...)`;
            } else {
              referenceName = 'Worker';
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

        return { data, total };
      } catch (error) {
        logger.error("Error in getTransactionsPaginated", {
          service: "ledger-storage",
          filter,
          limit,
          offset,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
        throw error;
      }
    },

    async getByAccountIdPaginated(accountId: string, limit: number, offset: number): Promise<{ data: LedgerEntryWithDetails[]; total: number }> {
      return this.getTransactionsPaginated({ accountId }, limit, offset);
    },

    async getRawByAccountId(accountId: string): Promise<RawLedgerEntryWithEntity[]> {
      const client = getClient();
      const rows = await client
        .select({
          entry: ledger,
          entityType: ledgerEa.entityType,
          entityId: ledgerEa.entityId,
        })
        .from(ledger)
        .innerJoin(ledgerEa, eq(ledger.eaId, ledgerEa.id))
        .where(eq(ledgerEa.accountId, accountId))
        .orderBy(desc(ledger.date));
      return rows.map(row => ({
        ...row.entry,
        entityType: row.entityType,
        entityId: row.entityId,
      }));
    },

    async create(insertEntry: InsertLedger): Promise<Ledger> {
      validate.validateOrThrow(insertEntry);
      const resolvedDate: Date = insertEntry.date instanceof Date
        ? insertEntry.date
        : insertEntry.date
          ? new Date(insertEntry.date)
          : new Date();
      const statementYmd = insertEntry.statementYmd
        ?? `${resolvedDate.getFullYear()}-${String(resolvedDate.getMonth() + 1).padStart(2, "0")}-${String(resolvedDate.getDate()).padStart(2, "0")}`;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(statementYmd)) {
        throw new Error("statementYmd must be in YYYY-MM-DD format");
      }
      const client = getClient();
      logger.debug("Creating ledger entry", {
        service: "ledger-storage",
        insertEntry,
      });
      try {
        const values: typeof ledger.$inferInsert = {
          ...insertEntry,
          date: resolvedDate,
          statementYmd,
        };
        const [entry] = await client.insert(ledger)
          .values(values)
          .returning();
        logger.debug("Created ledger entry successfully", {
          service: "ledger-storage",
          entryId: entry.id,
        });
        return entry;
      } catch (error) {
        logger.error("Failed to insert ledger entry", {
          service: "ledger-storage",
          insertEntry,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
        throw error;
      }
    },

    async update(id: string, entryUpdate: Partial<InsertLedger>): Promise<Ledger | undefined> {
      validate.validateOrThrow(id);
      const { date, ...rest } = entryUpdate;
      const safeUpdate: Partial<typeof ledger.$inferInsert> = { ...rest };
      if (date !== undefined) {
        safeUpdate.date = date === null
          ? null
          : date instanceof Date
            ? date
            : new Date(date);
      }
      const client = getClient();
      const [entry] = await client.update(ledger)
        .set(safeUpdate)
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
    },

    async deleteOrphansByChargePluginAndKnownKeys(
      chargePlugin: string,
      accountId: string,
      knownKeys: Set<string>,
    ): Promise<number> {
      const client = getClient();
      const eaRows = await client
        .select({ id: ledgerEa.id })
        .from(ledgerEa)
        .where(eq(ledgerEa.accountId, accountId));
      const eaIds = eaRows.map(r => r.id);
      if (eaIds.length === 0) return 0;

      const conditions = [
        eq(ledger.chargePlugin, chargePlugin),
        inArray(ledger.eaId, eaIds),
      ];
      if (knownKeys.size > 0) {
        conditions.push(notInArray(ledger.chargePluginKey, Array.from(knownKeys)));
      }
      const result = await client.delete(ledger).where(and(...conditions));
      return result.rowCount || 0;
    },

    async findByAccountEntityDatePlugin(accountId: string, entityId: string, date: Date, chargePluginId: string, chargePluginConfigId?: string, amount?: string): Promise<Ledger | undefined> {
      const client = getClient();
      const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
      const dayEnd = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
      const conditions = [
        eq(ledgerEa.accountId, accountId),
        eq(ledgerEa.entityId, entityId),
        eq(ledger.chargePlugin, chargePluginId),
        gte(ledger.date, dayStart),
        lte(ledger.date, dayEnd),
      ];
      if (chargePluginConfigId) {
        conditions.push(eq(ledger.chargePluginConfigId, chargePluginConfigId));
      }
      if (amount) {
        conditions.push(eq(ledger.amount, amount));
      }
      const [entry] = await client.select({ entry: ledger })
        .from(ledger)
        .innerJoin(ledgerEa, eq(ledger.eaId, ledgerEa.id))
        .where(and(...conditions))
        .limit(1);
      return entry?.entry || undefined;
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

type PaymentInfo = { category: string };

interface SectionSubtotals {
  chargesCents: bigint;
  adjustmentsCents: bigint;
  paymentsReceivedCents: bigint;
  paymentsAppliedCents: bigint;
}

function classifyEntriesForPeriod(
  monthEntryIds: Set<string>,
  allEntries: { id: string; amount: string; date: Date | null; statementYmd: string | null; referenceType: string | null; referenceId: string | null }[],
  paymentInfoMap: Map<string, PaymentInfo>,
  month: number,
  year: number,
): SectionSubtotals {
  let chargesCents = BigInt(0);
  let adjustmentsCents = BigInt(0);
  let paymentsReceivedCents = BigInt(0);
  let paymentsAppliedCents = BigInt(0);

  for (const entry of allEntries) {
    if (!monthEntryIds.has(entry.id)) continue;

    if (entry.referenceType === 'payment' && entry.referenceId) {
      const payInfo = paymentInfoMap.get(entry.referenceId);
      if (payInfo?.category !== 'adjustment') {
        const stmtYmd = entry.statementYmd;
        const stmtDate = stmtYmd ? new Date(stmtYmd) : null;
        const entryInPeriod = stmtDate &&
          stmtDate.getMonth() + 1 === month &&
          stmtDate.getFullYear() === year;
        if (entryInPeriod) {
          paymentsReceivedCents += toCents(entry.amount);
        }
      }
    } else {
      const amt = parseFloat(entry.amount);
      if (amt > 0) {
        chargesCents += toCents(entry.amount);
      }
    }
  }

  const sectionedIds = new Set<string>();
  for (const entry of allEntries) {
    if (entry.referenceType === 'payment' && entry.referenceId) {
      const payInfo = paymentInfoMap.get(entry.referenceId);
      if (!payInfo) continue;

      const stmtYmd = entry.statementYmd;
      const stmtDate = stmtYmd ? new Date(stmtYmd) : null;
      const stmtMonth = stmtDate ? stmtDate.getMonth() + 1 : null;
      const stmtYear = stmtDate ? stmtDate.getFullYear() : null;

      if (payInfo.category === 'adjustment' &&
          stmtMonth === month && stmtYear === year) {
        if (!sectionedIds.has(entry.id)) {
          sectionedIds.add(entry.id);
          adjustmentsCents += toCents(entry.amount);
        }
      } else if (payInfo.category !== 'adjustment' &&
          stmtMonth === month && stmtYear === year) {
        if (!sectionedIds.has(entry.id)) {
          sectionedIds.add(entry.id);
          paymentsAppliedCents += toCents(entry.amount);
        }
      }
    }
  }

  return { chargesCents, adjustmentsCents, paymentsReceivedCents, paymentsAppliedCents };
}

type SimpleLedgerEntry = { id: string; amount: string; date: Date | null; statementYmd: string | null };
type ExtendedSimpleLedgerEntry = SimpleLedgerEntry & { referenceType: string | null; referenceId: string | null };
interface InvoiceBucket {
  month: number;
  year: number;
  entries: SimpleLedgerEntry[];
  incomingBalanceCents: bigint;
}

function buildInvoicesForEa(entries: SimpleLedgerEntry[]): Map<string, InvoiceBucket> {
  const invoiceMap = new Map<string, InvoiceBucket>();
  
  const sortedEntries = [...entries].sort((a, b) => {
    const aYmd = a.statementYmd || (a.date ? new Date(a.date).toISOString().split('T')[0] : null);
    const bYmd = b.statementYmd || (b.date ? new Date(b.date).toISOString().split('T')[0] : null);
    if (!aYmd && !bYmd) return a.id.localeCompare(b.id);
    if (!aYmd) return 1;
    if (!bYmd) return -1;
    const dateCompare = aYmd.localeCompare(bYmd);
    if (dateCompare !== 0) return dateCompare;
    return a.id.localeCompare(b.id);
  });

  let runningBalanceCents = BigInt(0);

  for (const entry of sortedEntries) {
    const ymd = entry.statementYmd || (entry.date ? new Date(entry.date).toISOString().split('T')[0] : null);
    if (!ymd) continue;

    const d = new Date(ymd);
    const month = d.getMonth() + 1;
    const year = d.getFullYear();
    const key = `${year}-${month}`;

    if (!invoiceMap.has(key)) {
      invoiceMap.set(key, {
        month,
        year,
        entries: [],
        incomingBalanceCents: runningBalanceCents
      });
    }

    const bucket = invoiceMap.get(key)!;
    bucket.entries.push(entry);

    runningBalanceCents += toCents(entry.amount);
  }

  return invoiceMap;
}

function createLedgerInvoiceStorage(): LedgerInvoiceStorage {
  return {
    async listForEa(eaId: string): Promise<InvoiceSummary[]> {
      const client = getClient();
      const entries = await client.select({
        id: ledger.id,
        amount: ledger.amount,
        date: ledger.date,
        statementYmd: ledger.statementYmd,
        referenceType: ledger.referenceType,
        referenceId: ledger.referenceId,
      })
      .from(ledger)
      .where(eq(ledger.eaId, eaId))
      .orderBy(asc(ledger.date));

      if (entries.length === 0) {
        return [];
      }

      const invoiceMap = buildInvoicesForEa(entries);

      const allPaymentIds = [...new Set(
        entries
          .filter(e => e.referenceType === 'payment' && e.referenceId)
          .map(e => e.referenceId!)
      )];

      const paymentInfoMap = new Map<string, PaymentInfo>();
      if (allPaymentIds.length > 0) {
        const paymentRows = await client
          .select({
            paymentId: ledgerPayments.id,
            category: optionsLedgerPaymentType.category,
          })
          .from(ledgerPayments)
          .innerJoin(optionsLedgerPaymentType, eq(ledgerPayments.paymentType, optionsLedgerPaymentType.id))
          .where(inArray(ledgerPayments.id, allPaymentIds));

        for (const row of paymentRows) {
          paymentInfoMap.set(row.paymentId, {
            category: row.category ?? 'financial',
          });
        }
      }

      const summaries: InvoiceSummary[] = [];
      for (const bucket of Array.from(invoiceMap.values())) {
        const invoiceBalanceCents = bucket.entries.reduce(
          (sum: bigint, e: SimpleLedgerEntry) => sum + toCents(e.amount),
          BigInt(0)
        );
        const outgoingBalanceCents = bucket.incomingBalanceCents + invoiceBalanceCents;

        const monthEntryIds = new Set(bucket.entries.map(e => e.id));
        const sectionTotals = classifyEntriesForPeriod(
          monthEntryIds, entries, paymentInfoMap, bucket.month, bucket.year
        );

        summaries.push({
          month: bucket.month,
          year: bucket.year,
          totalAmount: fromCents(invoiceBalanceCents),
          entryCount: bucket.entries.length,
          incomingBalance: fromCents(bucket.incomingBalanceCents),
          invoiceBalance: fromCents(invoiceBalanceCents),
          outgoingBalance: fromCents(outgoingBalanceCents),
          chargesSubtotal: fromCents(sectionTotals.chargesCents),
          adjustmentsSubtotal: fromCents(sectionTotals.adjustmentsCents),
          paymentsReceivedSubtotal: fromCents(sectionTotals.paymentsReceivedCents),
          paymentsAppliedSubtotal: fromCents(sectionTotals.paymentsAppliedCents),
        });
      }

      summaries.sort((a, b) => {
        if (a.year !== b.year) return b.year - a.year;
        return b.month - a.month;
      });

      return summaries;
    },

    async getDetails(eaId: string, month: number, year: number): Promise<InvoiceDetails | undefined> {
      const client = getClient();
      const ea = await client.select().from(ledgerEa).where(eq(ledgerEa.id, eaId)).limit(1);
      if (ea.length === 0) {
        return undefined;
      }

      const account = await client.select().from(ledgerAccounts).where(eq(ledgerAccounts.id, ea[0].accountId)).limit(1);
      const accountData = (account.length > 0 && account[0]?.data) 
        ? account[0].data as { invoiceHeader?: string; invoiceFooter?: string } 
        : null;

      const simpleEntries = await client.select({
        id: ledger.id,
        amount: ledger.amount,
        date: ledger.date,
        statementYmd: ledger.statementYmd,
      })
      .from(ledger)
      .where(eq(ledger.eaId, eaId))
      .orderBy(asc(ledger.date));

      if (simpleEntries.length === 0) {
        return undefined;
      }

      const invoiceMap = buildInvoicesForEa(simpleEntries);
      const key = `${year}-${month}`;
      const bucket = invoiceMap.get(key);

      if (!bucket) {
        return undefined;
      }

      const entryStorage = createLedgerEntryStorage();
      const allDetailedEntries = await entryStorage.getTransactions({ eaId });
      
      const entryIds = new Set(bucket.entries.map(e => e.id));
      const monthEntries = allDetailedEntries.filter(entry => entryIds.has(entry.id));

      const allPaymentIds = allDetailedEntries
        .filter(e => e.referenceType === 'payment' && e.referenceId)
        .map(e => e.referenceId!);

      let paymentInfoMap = new Map<string, PaymentInfo>();
      if (allPaymentIds.length > 0) {
        const uniquePaymentIds = [...new Set(allPaymentIds)];
        const paymentRows = await client
          .select({
            paymentId: ledgerPayments.id,
            category: optionsLedgerPaymentType.category,
          })
          .from(ledgerPayments)
          .innerJoin(optionsLedgerPaymentType, eq(ledgerPayments.paymentType, optionsLedgerPaymentType.id))
          .where(inArray(ledgerPayments.id, uniquePaymentIds));

        for (const row of paymentRows) {
          paymentInfoMap.set(row.paymentId, {
            category: row.category ?? 'financial',
          });
        }
      }

      const charges: InvoiceSectionEntry[] = [];
      const adjustments: InvoiceSectionEntry[] = [];
      const paymentsReceived: InvoiceSectionEntry[] = [];
      const paymentsApplied: InvoiceSectionEntry[] = [];

      for (const entry of monthEntries) {
        if (entry.referenceType === 'payment' && entry.referenceId) {
          const payInfo = paymentInfoMap.get(entry.referenceId);
          const stmtYmd = entry.statementYmd;
          const stmtDate = stmtYmd ? new Date(stmtYmd) : null;
          const sectionEntry: InvoiceSectionEntry = {
            ...entry,
            paymentTypeCategory: payInfo?.category ?? 'financial',
            paymentStatementMonth: stmtDate ? stmtDate.getMonth() + 1 : null,
            paymentStatementYear: stmtDate ? stmtDate.getFullYear() : null,
          };

          if (payInfo?.category !== 'adjustment') {
            const entryInPeriod = stmtDate &&
              stmtDate.getMonth() + 1 === month &&
              stmtDate.getFullYear() === year;

            if (entryInPeriod) {
              paymentsReceived.push(sectionEntry);
            }
          }
        } else {
          const amt = parseFloat(entry.amount);
          if (amt > 0) {
            charges.push({ ...entry, paymentTypeCategory: null, paymentStatementMonth: null, paymentStatementYear: null });
          }
        }
      }

      const sectionedEntryIds = new Set<string>();
      for (const entry of allDetailedEntries) {
        if (entry.referenceType === 'payment' && entry.referenceId) {
          const payInfo = paymentInfoMap.get(entry.referenceId);
          if (!payInfo) continue;

          const stmtYmd = entry.statementYmd;
          const stmtDate = stmtYmd ? new Date(stmtYmd) : null;
          const stmtMonth = stmtDate ? stmtDate.getMonth() + 1 : null;
          const stmtYear = stmtDate ? stmtDate.getFullYear() : null;

          if (payInfo.category === 'adjustment' &&
              stmtMonth === month && stmtYear === year) {
            if (!sectionedEntryIds.has(entry.id)) {
              sectionedEntryIds.add(entry.id);
              adjustments.push({
                ...entry,
                paymentTypeCategory: payInfo.category,
                paymentStatementMonth: stmtMonth,
                paymentStatementYear: stmtYear,
              });
            }
          } else if (payInfo.category !== 'adjustment' &&
              stmtMonth === month && stmtYear === year) {
            if (!sectionedEntryIds.has(entry.id)) {
              sectionedEntryIds.add(entry.id);
              paymentsApplied.push({
                ...entry,
                paymentTypeCategory: payInfo.category,
                paymentStatementMonth: stmtMonth,
                paymentStatementYear: stmtYear,
              });
            }
          }
        }
      }

      const calcSubtotal = (entries: InvoiceSectionEntry[]) =>
        fromCents(entries.reduce((sum, e) => sum + toCents(e.amount), BigInt(0)));

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
        sections: {
          charges: { entries: charges, subtotal: calcSubtotal(charges) },
          adjustments: { entries: adjustments, subtotal: calcSubtotal(adjustments) },
          paymentsReceived: { entries: paymentsReceived, subtotal: calcSubtotal(paymentsReceived) },
          paymentsApplied: { entries: paymentsApplied, subtotal: calcSubtotal(paymentsApplied) },
        },
        invoiceHeader: accountData?.invoiceHeader ?? null,
        invoiceFooter: accountData?.invoiceFooter ?? null,
      };
    }
  };
}

export function createLedgerPaymentBatchStorage(): LedgerPaymentBatchStorage {
  return {
    async getAll(): Promise<LedgerPaymentBatch[]> {
      const client = getClient();
      return await client.select().from(ledgerPaymentBatches).orderBy(desc(ledgerPaymentBatches.name));
    },

    async getByAccountId(accountId: string): Promise<LedgerPaymentBatch[]> {
      const client = getClient();
      return await client.select().from(ledgerPaymentBatches)
        .where(eq(ledgerPaymentBatches.accountId, accountId))
        .orderBy(desc(ledgerPaymentBatches.name));
    },

    async get(id: string): Promise<LedgerPaymentBatch | undefined> {
      const client = getClient();
      const [batch] = await client.select().from(ledgerPaymentBatches).where(eq(ledgerPaymentBatches.id, id));
      return batch || undefined;
    },

    async create(insertBatch: InsertLedgerPaymentBatch): Promise<LedgerPaymentBatch> {
      validate.validateOrThrow(insertBatch);
      const client = getClient();
      const [batch] = await client.insert(ledgerPaymentBatches).values(insertBatch).returning();
      return batch;
    },

    async update(id: string, batchUpdate: Partial<InsertLedgerPaymentBatch>): Promise<LedgerPaymentBatch | undefined> {
      const client = getClient();
      const [batch] = await client.update(ledgerPaymentBatches)
        .set(batchUpdate)
        .where(eq(ledgerPaymentBatches.id, id))
        .returning();
      return batch || undefined;
    },

    async delete(id: string): Promise<boolean> {
      const client = getClient();
      const result = await client.delete(ledgerPaymentBatches).where(eq(ledgerPaymentBatches.id, id));
      return result.rowCount ? result.rowCount > 0 : false;
    },
  };
}

export function createLedgerPaymentBatchAssignmentStorage(): LedgerPaymentBatchAssignmentStorage {
  return {
    async getSummaryByBatchId(batchId: string): Promise<{ paymentsCount: number; paymentsTotal: string }> {
      const client = getClient();
      const rows = await client
        .select({
          paymentId: ledgerPaymentBatchAssignments.paymentId,
          amount: ledgerPayments.amount,
          status: ledgerPayments.status,
        })
        .from(ledgerPaymentBatchAssignments)
        .innerJoin(ledgerPayments, eq(ledgerPaymentBatchAssignments.paymentId, ledgerPayments.id))
        .where(eq(ledgerPaymentBatchAssignments.batchId, batchId));

      const paymentsCount = rows.length;
      const paymentsTotal = rows.reduce((sum, r) => sum + parseFloat(r.amount || "0"), 0);
      return {
        paymentsCount,
        paymentsTotal: paymentsTotal.toFixed(2),
      };
    },

    async getPaymentsByBatchId(batchId: string): Promise<LedgerPaymentWithAssignment[]> {
      const client = getClient();
      const rows = await client
        .select({
          payment: ledgerPayments,
          ea: ledgerEa,
          employer: employers,
          assignmentId: ledgerPaymentBatchAssignments.id,
        })
        .from(ledgerPaymentBatchAssignments)
        .innerJoin(ledgerPayments, eq(ledgerPaymentBatchAssignments.paymentId, ledgerPayments.id))
        .innerJoin(ledgerEa, eq(ledgerPayments.ledgerEaId, ledgerEa.id))
        .leftJoin(
          employers,
          and(eq(ledgerEa.entityType, "employer"), eq(ledgerEa.entityId, employers.id)),
        )
        .where(eq(ledgerPaymentBatchAssignments.batchId, batchId))
        .orderBy(sqlRaw`${ledgerPayments.dateReceived} DESC NULLS LAST`);

      return rows.map((r) => ({
        ...(r.payment as LedgerPayment),
        entityType: r.ea.entityType,
        entityId: r.ea.entityId,
        entityName: r.employer?.name ?? null,
        allocatedEntities: [],
        _assignmentId: r.assignmentId,
      }));
    },

    async assignPayment(batchId: string, paymentId: string): Promise<AssignPaymentResult> {
      const client = getClient();
      try {
        const [assignment] = await client
          .insert(ledgerPaymentBatchAssignments)
          .values({ batchId, paymentId })
          .returning();
        return { kind: "created", assignment };
      } catch (insertErr) {
        const code = (insertErr as { code?: string } | null)?.code;
        if (code === "23505") {
          const [existingAssignment] = await client
            .select()
            .from(ledgerPaymentBatchAssignments)
            .where(eq(ledgerPaymentBatchAssignments.paymentId, paymentId));
          if (existingAssignment) {
            return { kind: "conflict", assignment: existingAssignment };
          }
        }
        throw insertErr;
      }
    },

    async unassign(batchId: string, paymentId: string): Promise<boolean> {
      const client = getClient();
      const result = await client
        .delete(ledgerPaymentBatchAssignments)
        .where(
          and(
            eq(ledgerPaymentBatchAssignments.batchId, batchId),
            eq(ledgerPaymentBatchAssignments.paymentId, paymentId),
          ),
        );
      return result.rowCount ? result.rowCount > 0 : false;
    },
  };
}

export function createLedgerStorage(
  accountLoggingConfig?: StorageLoggingConfig<LedgerAccountStorage>,
  stripePaymentMethodLoggingConfig?: StorageLoggingConfig<StripePaymentMethodStorage>,
  eaLoggingConfig?: StorageLoggingConfig<LedgerEaStorage>,
  paymentLoggingConfig?: StorageLoggingConfig<LedgerPaymentStorage>,
  entryLoggingConfig?: StorageLoggingConfig<LedgerEntryStorage>,
  paymentBatchLoggingConfig?: StorageLoggingConfig<LedgerPaymentBatchStorage>
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

  const paymentBatchStorage = paymentBatchLoggingConfig
    ? withStorageLogging(createLedgerPaymentBatchStorage(), paymentBatchLoggingConfig)
    : createLedgerPaymentBatchStorage();
  
  const paymentTypeStorage = createLedgerPaymentTypeStorage();

  return {
    accounts: accountStorage,
    stripePaymentMethods: stripePaymentMethodStorage,
    ea: eaStorage,
    payments: paymentStorage,
    paymentTypes: paymentTypeStorage,
    entries: entryStorage,
    invoices: invoiceStorage,
    paymentBatches: paymentBatchStorage,
    paymentBatchAssignments: createLedgerPaymentBatchAssignmentStorage(),
  };
}

/**
 * Logging configuration for ledger account storage operations
 * 
 * Logs all ledger account mutations with full argument capture and change tracking.
 */
export const ledgerAccountLoggingConfig = defineLoggingConfig<LedgerAccountStorage>({
  module: 'ledger.accounts',
  methods: {
    create: { getEntityId: (args, result) => result?.id || args[0]?.name || 'new account' },
    update: {},
    delete: {},
  },
});

/**
 * Logging configuration for Stripe payment method storage operations
 * 
 * Logs all Stripe payment method mutations with full argument capture and change tracking.
 */
export const stripePaymentMethodLoggingConfig = defineLoggingConfig<StripePaymentMethodStorage>({
  module: 'ledger.stripePaymentMethods',
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

/**
 * Helper to format a payment for logging display
 */
function formatPaymentForLog(payment: LedgerPayment | undefined): string {
  if (!payment) return 'payment';
  const amount = payment.amount ? `$${payment.amount}` : '';
  const memo = payment.memo ? ` - ${payment.memo}` : '';
  return amount ? `${amount} payment${memo}` : 'payment';
}

export const ledgerPaymentBatchLoggingConfig = defineLoggingConfig<LedgerPaymentBatchStorage>({
  module: 'ledger.paymentBatches',
  hostEntityId: (args, result) => result?.id ?? args[0],
  methods: {
    create: { getEntityId: (args, result) => result?.id || args[0]?.name || 'new batch' },
    update: {},
    delete: {},
  },
});

/**
 * Logging configuration for ledger payment storage operations
 * 
 * Logs all payment mutations with full argument capture and change tracking.
 * Links to the payment entity via host_entity_id for per-payment log viewing.
 */
export const ledgerPaymentLoggingConfig: StorageLoggingConfig<LedgerPaymentStorage> = {
  module: 'ledger.payments',
  methods: {
    create: {
      enabled: true,
      getEntityId: (args, result) => formatPaymentForLog(result),
      getHostEntityId: async (args, result) => {
        return result?.id;
      },
      after: async (args, result, storage) => {
        return result;
      }
    },
    update: {
      enabled: true,
      getEntityId: (args, result, beforeState) => formatPaymentForLog(result || beforeState),
      getHostEntityId: async (args, result, beforeState) => {
        return result?.id || beforeState?.id || args[0];
      },
      before: async (args, storage) => {
        return await storage.get(args[0]);
      },
      after: async (args, result, storage) => {
        return result;
      }
    },
    delete: {
      enabled: true,
      getEntityId: (args, result, beforeState) => formatPaymentForLog(beforeState),
      getHostEntityId: async (args, result, beforeState) => {
        return beforeState?.id || args[0];
      },
      before: async (args, storage) => {
        return await storage.get(args[0]);
      }
    }
  }
};
