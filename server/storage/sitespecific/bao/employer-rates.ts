import { getClient } from '../../transaction-context';
import { and, eq, gte, lte, desc, asc, sql, getTableName } from "drizzle-orm";
import { tableExists as tableExistsUtil } from "../../utils";
import {
  sitespecificBaoEmployerRates,
  type BaoEmployerRate,
  type InsertBaoEmployerRate,
} from "../../../../shared/schema/sitespecific/bao/schema";
import type { StorageLoggingConfig } from "../../middleware/logging";

export type { BaoEmployerRate, InsertBaoEmployerRate };

export interface BaoEmployerRateFilters {
  employerId?: string;
  accountId?: string;
  fromYmd?: string;
  toYmd?: string;
  /** "active" returns only the currently-effective rate per (employer, account). */
  mode?: "active" | "history";
}

export interface BaoEmployerRatesStorage {
  list(filters: BaoEmployerRateFilters): Promise<BaoEmployerRate[]>;
  get(id: string): Promise<BaoEmployerRate | undefined>;
  bulkUpsert(entries: InsertBaoEmployerRate[]): Promise<BaoEmployerRate[]>;
  update(
    id: string,
    record: Partial<Pick<InsertBaoEmployerRate, "rate" | "effectiveYmd">>,
  ): Promise<BaoEmployerRate | undefined>;
  delete(id: string): Promise<boolean>;
  tableExists(): Promise<boolean>;
}

const tableName = getTableName(sitespecificBaoEmployerRates);

export function createBaoEmployerRatesStorage(): BaoEmployerRatesStorage {
  return {
    async tableExists(): Promise<boolean> {
      return tableExistsUtil(tableName);
    },

    async list(filters: BaoEmployerRateFilters): Promise<BaoEmployerRate[]> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      const client = getClient();
      const conditions = [];
      if (filters.employerId) {
        conditions.push(eq(sitespecificBaoEmployerRates.employerId, filters.employerId));
      }
      if (filters.accountId) {
        conditions.push(eq(sitespecificBaoEmployerRates.accountId, filters.accountId));
      }

      if (filters.mode === "active") {
        // The currently-effective rate per (employer, account): the row with
        // the greatest effective_ymd that is <= today. Date-range filters do
        // not apply in active mode; the "active" concept is anchored to today.
        conditions.push(
          lte(sitespecificBaoEmployerRates.effectiveYmd, sql`CURRENT_DATE`),
        );
        const rows = await client
          .selectDistinctOn(
            [
              sitespecificBaoEmployerRates.employerId,
              sitespecificBaoEmployerRates.accountId,
            ],
          )
          .from(sitespecificBaoEmployerRates)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .orderBy(
            asc(sitespecificBaoEmployerRates.employerId),
            asc(sitespecificBaoEmployerRates.accountId),
            desc(sitespecificBaoEmployerRates.effectiveYmd),
          );
        return rows;
      }

      if (filters.fromYmd) {
        conditions.push(gte(sitespecificBaoEmployerRates.effectiveYmd, filters.fromYmd));
      }
      if (filters.toYmd) {
        conditions.push(lte(sitespecificBaoEmployerRates.effectiveYmd, filters.toYmd));
      }
      return client
        .select()
        .from(sitespecificBaoEmployerRates)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(
          asc(sitespecificBaoEmployerRates.employerId),
          asc(sitespecificBaoEmployerRates.accountId),
          desc(sitespecificBaoEmployerRates.effectiveYmd),
        );
    },

    async get(id: string): Promise<BaoEmployerRate | undefined> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      const client = getClient();
      const results = await client
        .select()
        .from(sitespecificBaoEmployerRates)
        .where(eq(sitespecificBaoEmployerRates.id, id));
      return results[0];
    },

    async bulkUpsert(entries: InsertBaoEmployerRate[]): Promise<BaoEmployerRate[]> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      if (entries.length === 0) return [];
      const client = getClient();
      const results = await client
        .insert(sitespecificBaoEmployerRates)
        .values(entries)
        .onConflictDoUpdate({
          target: [
            sitespecificBaoEmployerRates.employerId,
            sitespecificBaoEmployerRates.accountId,
            sitespecificBaoEmployerRates.effectiveYmd,
          ],
          set: {
            rate: sql`excluded.rate`,
          },
        })
        .returning();
      return results;
    },

    async update(
      id: string,
      record: Partial<Pick<InsertBaoEmployerRate, "rate" | "effectiveYmd">>,
    ): Promise<BaoEmployerRate | undefined> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      const client = getClient();
      const results = await client
        .update(sitespecificBaoEmployerRates)
        .set(record)
        .where(eq(sitespecificBaoEmployerRates.id, id))
        .returning();
      return results[0];
    },

    async delete(id: string): Promise<boolean> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      const client = getClient();
      const results = await client
        .delete(sitespecificBaoEmployerRates)
        .where(eq(sitespecificBaoEmployerRates.id, id))
        .returning({ id: sitespecificBaoEmployerRates.id });
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
