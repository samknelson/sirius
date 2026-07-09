import { getClient } from '../../transaction-context';
import { and, eq, gte, lte, desc, asc, sql, getTableName } from "drizzle-orm";
import { tableExists as tableExistsUtil } from "../../utils";
import {
  sitespecificBaoEmployerRates,
  sitespecificBaoRateSources,
  type BaoEmployerRate,
  type BaoEmployerRateWithSource,
  type InsertBaoEmployerRate,
} from "../../../../shared/schema/sitespecific/bao/schema";
import type { StorageLoggingConfig } from "../../middleware/logging";

export type { BaoEmployerRate, BaoEmployerRateWithSource, InsertBaoEmployerRate };

export interface BaoEmployerRateFilters {
  employerId?: string;
  accountId?: string;
  sourceId?: string;
  fromYmd?: string;
  toYmd?: string;
  /** "active" returns only the currently-effective rate per (employer, account). */
  mode?: "active" | "history";
}

export interface BaoEmployerRatesStorage {
  list(filters: BaoEmployerRateFilters): Promise<BaoEmployerRateWithSource[]>;
  get(id: string): Promise<BaoEmployerRate | undefined>;
  /**
   * The effective rate for an employer + account as of a date: the ACTIVE row
   * with the greatest effective_ymd <= asOfYmd, or undefined when none exists.
   * A row is inactive when a newer source associated with the same employer
   * (start date strictly after the row's source's start) has a start date
   * on/before the row's effective date. Sourceless rows are always active.
   */
  getEffectiveRate(
    employerId: string,
    accountId: string,
    asOfYmd: string,
  ): Promise<BaoEmployerRate | undefined>;
  bulkUpsert(entries: InsertBaoEmployerRate[]): Promise<BaoEmployerRate[]>;
  update(
    id: string,
    record: Partial<Pick<InsertBaoEmployerRate, "rate" | "effectiveYmd" | "sourceId">>,
  ): Promise<BaoEmployerRate | undefined>;
  delete(id: string): Promise<boolean>;
  tableExists(): Promise<boolean>;
}

const tableName = getTableName(sitespecificBaoEmployerRates);

const rates = sitespecificBaoEmployerRates;
const sources = sitespecificBaoRateSources;

/**
 * SQL predicate: the rate row is active. A row with no source is always
 * active. A sourced row is inactive iff some OTHER source associated with the
 * same employer starts strictly after this row's source AND on/before the
 * row's effective date (that newer source governs the period).
 */
const isActiveExpr = sql<boolean>`(
  ${rates.sourceId} IS NULL OR NOT EXISTS (
    SELECT 1
    FROM sitespecific_bao_rate_source_employers assoc
    JOIN sitespecific_bao_rate_sources newer ON newer.id = assoc.source_id
    WHERE assoc.employer_id = ${rates.employerId}
      AND newer.id <> ${rates.sourceId}
      AND newer.start_ymd > (
        SELECT own.start_ymd FROM sitespecific_bao_rate_sources own
        WHERE own.id = ${rates.sourceId}
      )
      AND newer.start_ymd <= ${rates.effectiveYmd}
  )
)`;

const enrichedSelection = {
  id: rates.id,
  employerId: rates.employerId,
  accountId: rates.accountId,
  rate: rates.rate,
  effectiveYmd: rates.effectiveYmd,
  sourceId: rates.sourceId,
  data: rates.data,
  sourceName: sources.name,
  sourceType: sources.type,
  sourceStartYmd: sources.startYmd,
  isActive: isActiveExpr,
};

export function createBaoEmployerRatesStorage(): BaoEmployerRatesStorage {
  return {
    async tableExists(): Promise<boolean> {
      return tableExistsUtil(tableName);
    },

    async list(filters: BaoEmployerRateFilters): Promise<BaoEmployerRateWithSource[]> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      const client = getClient();
      const conditions = [];
      if (filters.employerId) {
        conditions.push(eq(rates.employerId, filters.employerId));
      }
      if (filters.accountId) {
        conditions.push(eq(rates.accountId, filters.accountId));
      }
      if (filters.sourceId) {
        conditions.push(eq(rates.sourceId, filters.sourceId));
      }

      if (filters.mode === "active") {
        // The currently-effective rate per (employer, account): the row with
        // the greatest effective_ymd that is <= today among ACTIVE rows.
        // Date-range filters do not apply in active mode.
        conditions.push(lte(rates.effectiveYmd, sql`CURRENT_DATE`));
        conditions.push(sql`${isActiveExpr} = true`);
        const rows = await client
          .selectDistinctOn([rates.employerId, rates.accountId], enrichedSelection)
          .from(rates)
          .leftJoin(sources, eq(sources.id, rates.sourceId))
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .orderBy(
            asc(rates.employerId),
            asc(rates.accountId),
            desc(rates.effectiveYmd),
          );
        return rows as BaoEmployerRateWithSource[];
      }

      if (filters.fromYmd) {
        conditions.push(gte(rates.effectiveYmd, filters.fromYmd));
      }
      if (filters.toYmd) {
        conditions.push(lte(rates.effectiveYmd, filters.toYmd));
      }
      const rows = await client
        .select(enrichedSelection)
        .from(rates)
        .leftJoin(sources, eq(sources.id, rates.sourceId))
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(
          asc(rates.employerId),
          asc(rates.accountId),
          desc(rates.effectiveYmd),
        );
      return rows as BaoEmployerRateWithSource[];
    },

    async get(id: string): Promise<BaoEmployerRate | undefined> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      const client = getClient();
      const results = await client
        .select()
        .from(rates)
        .where(eq(rates.id, id));
      return results[0];
    },

    async getEffectiveRate(
      employerId: string,
      accountId: string,
      asOfYmd: string,
    ): Promise<BaoEmployerRate | undefined> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      const client = getClient();
      const results = await client
        .select()
        .from(rates)
        .where(
          and(
            eq(rates.employerId, employerId),
            eq(rates.accountId, accountId),
            lte(rates.effectiveYmd, asOfYmd),
            sql`${isActiveExpr} = true`,
          ),
        )
        .orderBy(desc(rates.effectiveYmd))
        .limit(1);
      return results[0];
    },

    async bulkUpsert(entries: InsertBaoEmployerRate[]): Promise<BaoEmployerRate[]> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      if (entries.length === 0) return [];
      const client = getClient();
      const results = await client
        .insert(rates)
        .values(entries)
        .onConflictDoUpdate({
          target: [rates.employerId, rates.accountId, rates.effectiveYmd],
          set: {
            rate: sql`excluded.rate`,
            sourceId: sql`excluded.source_id`,
          },
        })
        .returning();
      return results;
    },

    async update(
      id: string,
      record: Partial<Pick<InsertBaoEmployerRate, "rate" | "effectiveYmd" | "sourceId">>,
    ): Promise<BaoEmployerRate | undefined> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      const client = getClient();
      const results = await client
        .update(rates)
        .set(record)
        .where(eq(rates.id, id))
        .returning();
      return results[0];
    },

    async delete(id: string): Promise<boolean> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      const client = getClient();
      const results = await client
        .delete(rates)
        .where(eq(rates.id, id))
        .returning({ id: rates.id });
      return results.length > 0;
    },
  };
}

export const baoEmployerRatesLoggingConfig: StorageLoggingConfig<BaoEmployerRatesStorage> = {
  module: 'sitespecific.bao.employer-rates',
  methods: {
    bulkUpsert: {
      enabled: true,
      getEntityId: (args, result) => result?.[0]?.id,
      getDescription: (args, result) =>
        `Bulk upserted ${result?.length ?? args[0]?.length ?? 0} BAO employer rate entries`,
    },
    update: {
      enabled: true,
      before: async (args, storage) => storage.get(args[0]),
      getEntityId: (args) => args[0],
      getHostEntityId: (args, result, beforeState) =>
        result?.employerId ?? beforeState?.employerId,
      getDescription: (args, result) =>
        `Updated BAO employer rate to ${result?.rate} effective ${result?.effectiveYmd}`,
    },
    delete: {
      enabled: true,
      before: async (args, storage) => storage.get(args[0]),
      getEntityId: (args) => args[0],
      getHostEntityId: (args, result, beforeState) => beforeState?.employerId,
      getDescription: () => `Deleted BAO employer rate entry`,
    },
  },
};
