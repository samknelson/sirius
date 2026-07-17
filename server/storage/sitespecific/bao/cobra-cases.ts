import { getClient, runInTransaction } from '../../transaction-context';
import { and, eq, gte, lte, ne, desc, sql, getTableName, aliasedTable } from "drizzle-orm";
import { tableExists as tableExistsUtil } from "../../utils";
import {
  sitespecificBaoCobraCases,
  optionsBaoCobraStatus,
  optionsBaoCobraQualifyingEvent,
  workers,
  contacts,
  trustBenefits,
  trustWmb,
  optionsTrustBenefitType,
  type BaoCobraCase,
  type BaoCobraCaseWithDetails,
  type InsertBaoCobraCase,
} from "@shared/schema";
import type { StorageLoggingConfig } from "../../middleware/logging";

export type { BaoCobraCase, BaoCobraCaseWithDetails, InsertBaoCobraCase };

export interface BaoCobraCaseFilters {
  statusId?: string;
  qualifyingEventId?: string;
  /** Matches either the covered person or the subscriber. */
  workerId?: string;
  /** Range filter on cobra_effective_ymd. */
  fromYmd?: string;
  toYmd?: string;
}

export interface BaoCobraCasesStorage {
  search(filters: BaoCobraCaseFilters): Promise<BaoCobraCaseWithDetails[]>;
  get(id: string): Promise<BaoCobraCaseWithDetails | undefined>;
  getRaw(id: string): Promise<BaoCobraCase | undefined>;
  create(entry: InsertBaoCobraCase): Promise<BaoCobraCase>;
  update(id: string, record: Partial<InsertBaoCobraCase>): Promise<BaoCobraCase | undefined>;
  /**
   * Create a case while atomically enforcing the active-case invariants.
   * Runs in a transaction holding a per-covered-person advisory lock, so two
   * concurrent creates for the same person cannot both pass the check.
   * When `statusIsClosed` is true the invariants do not apply.
   * Throws Error("ACTIVE_CASE_EXISTS") or Error("ACTIVE_BENEFITS_EXIST").
   */
  createEnforcingInvariants(
    entry: InsertBaoCobraCase,
    statusIsClosed: boolean,
  ): Promise<BaoCobraCase>;
  /**
   * Update a case while atomically enforcing the active-case invariants for
   * the case's covered person (excluding the case itself). Same locking and
   * error contract as createEnforcingInvariants.
   */
  updateEnforcingInvariants(
    id: string,
    record: Partial<InsertBaoCobraCase>,
    coveredPersonWorkerId: string,
    statusIsClosed: boolean,
  ): Promise<BaoCobraCase | undefined>;
  delete(id: string): Promise<boolean>;
  /**
   * True when the worker already has an active (non-closed-status) case as
   * covered person, other than excludeCaseId.
   */
  hasActiveCaseForCoveredPerson(
    coveredPersonWorkerId: string,
    excludeCaseId?: string,
  ): Promise<boolean>;
  /**
   * True when the worker has current-month WMB coverage on a benefit whose
   * benefit type looks like medical or dental — i.e. they still have active
   * medical/dental benefits and should not have an active COBRA case.
   */
  hasActiveMedicalOrDentalBenefits(workerId: string): Promise<boolean>;
  tableExists(): Promise<boolean>;
}

const tableName = getTableName(sitespecificBaoCobraCases);
const cases = sitespecificBaoCobraCases;

const coveredContacts = aliasedTable(contacts, "covered_contacts");
const subscriberContacts = aliasedTable(contacts, "subscriber_contacts");
const coveredWorkers = aliasedTable(workers, "covered_workers");
const subscriberWorkers = aliasedTable(workers, "subscriber_workers");
const medicalBenefits = aliasedTable(trustBenefits, "medical_benefits");
const dentalBenefits = aliasedTable(trustBenefits, "dental_benefits");

const enrichedSelection = {
  id: cases.id,
  source: cases.source,
  statusId: cases.statusId,
  qualifyingEventId: cases.qualifyingEventId,
  coveredPersonWorkerId: cases.coveredPersonWorkerId,
  subscriberWorkerId: cases.subscriberWorkerId,
  relationship: cases.relationship,
  cobraEffectiveYmd: cases.cobraEffectiveYmd,
  offerYmd: cases.offerYmd,
  lastDayToElectYmd: cases.lastDayToElectYmd,
  electionMadeYmd: cases.electionMadeYmd,
  initialPaymentDeadlineYmd: cases.initialPaymentDeadlineYmd,
  paymentStatus: cases.paymentStatus,
  medicalBenefitLostId: cases.medicalBenefitLostId,
  dentalBenefitLostId: cases.dentalBenefitLostId,
  maxPeriodYmd: cases.maxPeriodYmd,
  data: cases.data,
  statusName: optionsBaoCobraStatus.name,
  statusClosed: optionsBaoCobraStatus.closed,
  qualifyingEventName: optionsBaoCobraQualifyingEvent.name,
  coveredPersonName: coveredContacts.displayName,
  subscriberName: subscriberContacts.displayName,
  medicalBenefitLostName: medicalBenefits.name,
  dentalBenefitLostName: dentalBenefits.name,
};

function enrichedQuery(client: ReturnType<typeof getClient>) {
  return client
    .select(enrichedSelection)
    .from(cases)
    .leftJoin(optionsBaoCobraStatus, eq(optionsBaoCobraStatus.id, cases.statusId))
    .leftJoin(
      optionsBaoCobraQualifyingEvent,
      eq(optionsBaoCobraQualifyingEvent.id, cases.qualifyingEventId),
    )
    .leftJoin(coveredWorkers, eq(coveredWorkers.id, cases.coveredPersonWorkerId))
    .leftJoin(coveredContacts, eq(coveredContacts.id, coveredWorkers.contactId))
    .leftJoin(subscriberWorkers, eq(subscriberWorkers.id, cases.subscriberWorkerId))
    .leftJoin(subscriberContacts, eq(subscriberContacts.id, subscriberWorkers.contactId))
    .leftJoin(medicalBenefits, eq(medicalBenefits.id, cases.medicalBenefitLostId))
    .leftJoin(dentalBenefits, eq(dentalBenefits.id, cases.dentalBenefitLostId));
}

/** Transaction-scoped advisory lock serializing writers per covered person. */
async function lockCoveredPerson(coveredPersonWorkerId: string): Promise<void> {
  const client = getClient();
  await client.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${'bao-cobra-case:' + coveredPersonWorkerId}, 0))`,
  );
}

/** Re-check the active-case invariants inside the lock; throws coded errors. */
async function assertInvariants(
  storage: BaoCobraCasesStorage,
  coveredPersonWorkerId: string,
  excludeCaseId?: string,
): Promise<void> {
  if (await storage.hasActiveCaseForCoveredPerson(coveredPersonWorkerId, excludeCaseId)) {
    throw new Error("ACTIVE_CASE_EXISTS");
  }
  if (await storage.hasActiveMedicalOrDentalBenefits(coveredPersonWorkerId)) {
    throw new Error("ACTIVE_BENEFITS_EXIST");
  }
}

export function createBaoCobraCasesStorage(): BaoCobraCasesStorage {
  return {
    async tableExists(): Promise<boolean> {
      return tableExistsUtil(tableName);
    },

    async search(filters: BaoCobraCaseFilters): Promise<BaoCobraCaseWithDetails[]> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      const client = getClient();
      const conditions = [];
      if (filters.statusId) {
        conditions.push(eq(cases.statusId, filters.statusId));
      }
      if (filters.qualifyingEventId) {
        conditions.push(eq(cases.qualifyingEventId, filters.qualifyingEventId));
      }
      if (filters.workerId) {
        conditions.push(
          sql`(${cases.coveredPersonWorkerId} = ${filters.workerId} OR ${cases.subscriberWorkerId} = ${filters.workerId})`,
        );
      }
      if (filters.fromYmd) {
        conditions.push(gte(cases.cobraEffectiveYmd, filters.fromYmd));
      }
      if (filters.toYmd) {
        conditions.push(lte(cases.cobraEffectiveYmd, filters.toYmd));
      }
      const rows = await enrichedQuery(client)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(cases.cobraEffectiveYmd), desc(cases.id));
      return rows as BaoCobraCaseWithDetails[];
    },

    async get(id: string): Promise<BaoCobraCaseWithDetails | undefined> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      const client = getClient();
      const rows = await enrichedQuery(client).where(eq(cases.id, id));
      return rows[0] as BaoCobraCaseWithDetails | undefined;
    },

    async getRaw(id: string): Promise<BaoCobraCase | undefined> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      const client = getClient();
      const results = await client.select().from(cases).where(eq(cases.id, id));
      return results[0];
    },

    async create(entry: InsertBaoCobraCase): Promise<BaoCobraCase> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      const client = getClient();
      const results = await client.insert(cases).values(entry).returning();
      return results[0];
    },

    async update(
      id: string,
      record: Partial<InsertBaoCobraCase>,
    ): Promise<BaoCobraCase | undefined> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      const client = getClient();
      const results = await client
        .update(cases)
        .set(record)
        .where(eq(cases.id, id))
        .returning();
      return results[0];
    },

    async createEnforcingInvariants(
      entry: InsertBaoCobraCase,
      statusIsClosed: boolean,
    ): Promise<BaoCobraCase> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      return runInTransaction(async () => {
        if (!statusIsClosed) {
          await lockCoveredPerson(entry.coveredPersonWorkerId);
          await assertInvariants(this, entry.coveredPersonWorkerId);
        }
        const client = getClient();
        const results = await client.insert(cases).values(entry).returning();
        return results[0];
      });
    },

    async updateEnforcingInvariants(
      id: string,
      record: Partial<InsertBaoCobraCase>,
      coveredPersonWorkerId: string,
      statusIsClosed: boolean,
    ): Promise<BaoCobraCase | undefined> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      return runInTransaction(async () => {
        if (!statusIsClosed) {
          await lockCoveredPerson(coveredPersonWorkerId);
          await assertInvariants(this, coveredPersonWorkerId, id);
        }
        const client = getClient();
        const results = await client
          .update(cases)
          .set(record)
          .where(eq(cases.id, id))
          .returning();
        return results[0];
      });
    },

    async delete(id: string): Promise<boolean> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      const client = getClient();
      const results = await client
        .delete(cases)
        .where(eq(cases.id, id))
        .returning({ id: cases.id });
      return results.length > 0;
    },

    async hasActiveCaseForCoveredPerson(
      coveredPersonWorkerId: string,
      excludeCaseId?: string,
    ): Promise<boolean> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      const client = getClient();
      const conditions = [
        eq(cases.coveredPersonWorkerId, coveredPersonWorkerId),
        eq(optionsBaoCobraStatus.closed, false),
      ];
      if (excludeCaseId) {
        conditions.push(ne(cases.id, excludeCaseId));
      }
      const rows = await client
        .select({ id: cases.id })
        .from(cases)
        .innerJoin(optionsBaoCobraStatus, eq(optionsBaoCobraStatus.id, cases.statusId))
        .where(and(...conditions))
        .limit(1);
      return rows.length > 0;
    },

    async hasActiveMedicalOrDentalBenefits(workerId: string): Promise<boolean> {
      const client = getClient();
      const now = new Date();
      const month = now.getMonth() + 1;
      const year = now.getFullYear();
      const rows = await client
        .select({ id: trustWmb.id })
        .from(trustWmb)
        .innerJoin(trustBenefits, eq(trustBenefits.id, trustWmb.benefitId))
        .leftJoin(
          optionsTrustBenefitType,
          eq(optionsTrustBenefitType.id, trustBenefits.benefitType),
        )
        .where(
          and(
            eq(trustWmb.workerId, workerId),
            eq(trustWmb.month, month),
            eq(trustWmb.year, year),
            sql`(${optionsTrustBenefitType.name} ILIKE '%medical%' OR ${optionsTrustBenefitType.name} ILIKE '%dental%' OR ${trustBenefits.name} ILIKE '%medical%' OR ${trustBenefits.name} ILIKE '%dental%')`,
          ),
        )
        .limit(1);
      return rows.length > 0;
    },
  };
}

export const baoCobraCasesLoggingConfig: StorageLoggingConfig<BaoCobraCasesStorage> = {
  module: 'sitespecific.bao.cobra-cases',
  methods: {
    create: {
      enabled: true,
      getEntityId: (args, result) => result?.id,
      getHostEntityId: (args, result) => result?.coveredPersonWorkerId,
      getDescription: (args, result) =>
        `Created COBRA case (source ${result?.source}) effective ${result?.cobraEffectiveYmd}`,
    },
    createEnforcingInvariants: {
      enabled: true,
      getEntityId: (args, result) => result?.id,
      getHostEntityId: (args, result) => result?.coveredPersonWorkerId,
      getDescription: (args, result) =>
        `Created COBRA case (source ${result?.source}) effective ${result?.cobraEffectiveYmd}`,
    },
    update: {
      enabled: true,
      before: async (args, storage) => storage.getRaw(args[0]),
      getEntityId: (args) => args[0],
      getHostEntityId: (args, result, beforeState) =>
        result?.coveredPersonWorkerId ?? beforeState?.coveredPersonWorkerId,
      getDescription: () => `Updated COBRA case`,
    },
    updateEnforcingInvariants: {
      enabled: true,
      before: async (args, storage) => storage.getRaw(args[0]),
      getEntityId: (args) => args[0],
      getHostEntityId: (args, result, beforeState) =>
        result?.coveredPersonWorkerId ?? beforeState?.coveredPersonWorkerId,
      getDescription: () => `Updated COBRA case`,
    },
    delete: {
      enabled: true,
      before: async (args, storage) => storage.getRaw(args[0]),
      getEntityId: (args) => args[0],
      getHostEntityId: (args, result, beforeState) => beforeState?.coveredPersonWorkerId,
      getDescription: () => `Deleted COBRA case`,
    },
  },
};
