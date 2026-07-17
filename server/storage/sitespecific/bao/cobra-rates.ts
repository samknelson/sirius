import { getClient } from '../../transaction-context';
import { and, eq, lte, desc, asc, getTableName } from "drizzle-orm";
import { tableExists as tableExistsUtil } from "../../utils";
import {
  sitespecificBaoCobraRates,
  trustBenefits,
  type BaoCobraRate,
  type BaoCobraRateWithBenefit,
  type BaoCobraCoveredLivesTier,
  type InsertBaoCobraRate,
} from "@shared/schema";
import type { StorageLoggingConfig } from "../../middleware/logging";

export type { BaoCobraRate, BaoCobraRateWithBenefit, InsertBaoCobraRate };

export interface BaoCobraRateFilters {
  benefitId?: string;
  coveredLivesTier?: BaoCobraCoveredLivesTier;
}

export interface BaoCobraRatesStorage {
  list(filters: BaoCobraRateFilters): Promise<BaoCobraRateWithBenefit[]>;
  get(id: string): Promise<BaoCobraRate | undefined>;
  /**
   * The effective rate for a benefit + covered-lives tier as of a date:
   * the row with the greatest effective_ymd <= asOfYmd, or undefined.
   */
  getEffectiveRate(
    benefitId: string,
    coveredLivesTier: BaoCobraCoveredLivesTier,
    asOfYmd: string,
  ): Promise<BaoCobraRate | undefined>;
  create(entry: InsertBaoCobraRate): Promise<BaoCobraRate>;
  update(
    id: string,
    record: Partial<
      Pick<InsertBaoCobraRate, "benefitId" | "coveredLivesTier" | "rate" | "effectiveYmd">
    >,
  ): Promise<BaoCobraRate | undefined>;
  delete(id: string): Promise<boolean>;
  tableExists(): Promise<boolean>;
}

const tableName = getTableName(sitespecificBaoCobraRates);
const rates = sitespecificBaoCobraRates;

const enrichedSelection = {
  id: rates.id,
  benefitId: rates.benefitId,
  coveredLivesTier: rates.coveredLivesTier,
  rate: rates.rate,
  effectiveYmd: rates.effectiveYmd,
  data: rates.data,
  benefitName: trustBenefits.name,
};

export function createBaoCobraRatesStorage(): BaoCobraRatesStorage {
  return {
    async tableExists(): Promise<boolean> {
      return tableExistsUtil(tableName);
    },

    async list(filters: BaoCobraRateFilters): Promise<BaoCobraRateWithBenefit[]> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      const client = getClient();
      const conditions = [];
      if (filters.benefitId) {
        conditions.push(eq(rates.benefitId, filters.benefitId));
      }
      if (filters.coveredLivesTier) {
        conditions.push(eq(rates.coveredLivesTier, filters.coveredLivesTier));
      }
      const rows = await client
        .select(enrichedSelection)
        .from(rates)
        .leftJoin(trustBenefits, eq(trustBenefits.id, rates.benefitId))
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(
          asc(trustBenefits.name),
          asc(rates.coveredLivesTier),
          desc(rates.effectiveYmd),
        );
      return rows as BaoCobraRateWithBenefit[];
    },

    async get(id: string): Promise<BaoCobraRate | undefined> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      const client = getClient();
      const results = await client.select().from(rates).where(eq(rates.id, id));
      return results[0];
    },

    async getEffectiveRate(
      benefitId: string,
      coveredLivesTier: BaoCobraCoveredLivesTier,
      asOfYmd: string,
    ): Promise<BaoCobraRate | undefined> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      const client = getClient();
      const results = await client
        .select()
        .from(rates)
        .where(
          and(
            eq(rates.benefitId, benefitId),
            eq(rates.coveredLivesTier, coveredLivesTier),
            lte(rates.effectiveYmd, asOfYmd),
          ),
        )
        .orderBy(desc(rates.effectiveYmd))
        .limit(1);
      return results[0];
    },

    async create(entry: InsertBaoCobraRate): Promise<BaoCobraRate> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      const client = getClient();
      const results = await client.insert(rates).values(entry).returning();
      return results[0];
    },

    async update(
      id: string,
      record: Partial<
        Pick<InsertBaoCobraRate, "benefitId" | "coveredLivesTier" | "rate" | "effectiveYmd">
      >,
    ): Promise<BaoCobraRate | undefined> {
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

export const baoCobraRatesLoggingConfig: StorageLoggingConfig<BaoCobraRatesStorage> = {
  module: 'sitespecific.bao.cobra-rates',
  methods: {
    create: {
      enabled: true,
      getEntityId: (args, result) => result?.id,
      getDescription: (args, result) =>
        `Created COBRA rate ${result?.rate} (tier ${result?.coveredLivesTier}) effective ${result?.effectiveYmd}`,
    },
    update: {
      enabled: true,
      before: async (args, storage) => storage.get(args[0]),
      getEntityId: (args) => args[0],
      getDescription: (args, result) =>
        `Updated COBRA rate to ${result?.rate} (tier ${result?.coveredLivesTier}) effective ${result?.effectiveYmd}`,
    },
    delete: {
      enabled: true,
      before: async (args, storage) => storage.get(args[0]),
      getEntityId: (args) => args[0],
      getDescription: () => `Deleted COBRA rate entry`,
    },
  },
};
