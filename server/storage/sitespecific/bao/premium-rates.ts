import { getClient } from '../../transaction-context';
import { and, eq, lte, desc, asc, getTableName } from "drizzle-orm";
import { tableExists as tableExistsUtil } from "../../utils";
import {
  sitespecificBaoPremiumRates,
  trustBenefits,
  type BaoPremiumRate,
  type BaoPremiumRateWithBenefit,
  type BaoPremiumCoverageTier,
  type InsertBaoPremiumRate,
} from "@shared/schema";
import type { StorageLoggingConfig } from "../../middleware/logging";

export type { BaoPremiumRate, BaoPremiumRateWithBenefit, InsertBaoPremiumRate };

export interface BaoPremiumRateFilters {
  benefitId?: string;
  coverageTier?: BaoPremiumCoverageTier;
}

export interface BaoPremiumRatesStorage {
  list(filters: BaoPremiumRateFilters): Promise<BaoPremiumRateWithBenefit[]>;
  get(id: string): Promise<BaoPremiumRate | undefined>;
  /**
   * The effective premium rate for a benefit + coverage tier as of a date:
   * the row with the greatest effective_ymd <= asOfYmd, or undefined.
   * No fallback — when no effective-dated rate applies, nothing is returned.
   */
  getEffectiveRate(
    benefitId: string,
    coverageTier: BaoPremiumCoverageTier,
    asOfYmd: string,
  ): Promise<BaoPremiumRate | undefined>;
  create(entry: InsertBaoPremiumRate): Promise<BaoPremiumRate>;
  update(
    id: string,
    record: Partial<
      Pick<InsertBaoPremiumRate, "benefitId" | "coverageTier" | "rate" | "effectiveYmd">
    >,
  ): Promise<BaoPremiumRate | undefined>;
  delete(id: string): Promise<boolean>;
  tableExists(): Promise<boolean>;
}

const tableName = getTableName(sitespecificBaoPremiumRates);
const rates = sitespecificBaoPremiumRates;

const enrichedSelection = {
  id: rates.id,
  benefitId: rates.benefitId,
  coverageTier: rates.coverageTier,
  rate: rates.rate,
  effectiveYmd: rates.effectiveYmd,
  data: rates.data,
  benefitName: trustBenefits.name,
};

export function createBaoPremiumRatesStorage(): BaoPremiumRatesStorage {
  return {
    async tableExists(): Promise<boolean> {
      return tableExistsUtil(tableName);
    },

    async list(filters: BaoPremiumRateFilters): Promise<BaoPremiumRateWithBenefit[]> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      const client = getClient();
      const conditions = [];
      if (filters.benefitId) {
        conditions.push(eq(rates.benefitId, filters.benefitId));
      }
      if (filters.coverageTier) {
        conditions.push(eq(rates.coverageTier, filters.coverageTier));
      }
      const rows = await client
        .select(enrichedSelection)
        .from(rates)
        .leftJoin(trustBenefits, eq(trustBenefits.id, rates.benefitId))
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(
          asc(trustBenefits.name),
          asc(rates.coverageTier),
          desc(rates.effectiveYmd),
        );
      return rows as BaoPremiumRateWithBenefit[];
    },

    async get(id: string): Promise<BaoPremiumRate | undefined> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      const client = getClient();
      const results = await client.select().from(rates).where(eq(rates.id, id));
      return results[0];
    },

    async getEffectiveRate(
      benefitId: string,
      coverageTier: BaoPremiumCoverageTier,
      asOfYmd: string,
    ): Promise<BaoPremiumRate | undefined> {
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
            eq(rates.coverageTier, coverageTier),
            lte(rates.effectiveYmd, asOfYmd),
          ),
        )
        .orderBy(desc(rates.effectiveYmd))
        .limit(1);
      return results[0];
    },

    async create(entry: InsertBaoPremiumRate): Promise<BaoPremiumRate> {
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
        Pick<InsertBaoPremiumRate, "benefitId" | "coverageTier" | "rate" | "effectiveYmd">
      >,
    ): Promise<BaoPremiumRate | undefined> {
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

export const baoPremiumRatesLoggingConfig: StorageLoggingConfig<BaoPremiumRatesStorage> = {
  module: 'sitespecific.bao.premium-rates',
  methods: {
    create: {
      enabled: true,
      getEntityId: (args, result) => result?.id,
      getDescription: (args, result) =>
        `Created premium rate ${result?.rate} (tier ${result?.coverageTier}) effective ${result?.effectiveYmd}`,
    },
    update: {
      enabled: true,
      before: async (args, storage) => storage.get(args[0]),
      getEntityId: (args) => args[0],
      getDescription: (args, result) =>
        `Updated premium rate to ${result?.rate} (tier ${result?.coverageTier}) effective ${result?.effectiveYmd}`,
    },
    delete: {
      enabled: true,
      before: async (args, storage) => storage.get(args[0]),
      getEntityId: (args) => args[0],
      getDescription: () => `Deleted premium rate entry`,
    },
  },
};
