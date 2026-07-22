import { getClient } from '../../transaction-context';
import { and, eq, lte, desc, asc, getTableName } from "drizzle-orm";
import { tableExists as tableExistsUtil } from "../../utils";
import {
  sitespecificBaoDpRates,
  trustBenefits,
  type BaoDpRate,
  type BaoDpRateWithBenefit,
  type BaoDpTierTransition,
  type InsertBaoDpRate,
} from "@shared/schema";
import type { StorageLoggingConfig } from "../../middleware/logging";

export type { BaoDpRate, BaoDpRateWithBenefit, InsertBaoDpRate };

export interface BaoDpRateFilters {
  benefitId?: string;
  tierTransition?: BaoDpTierTransition;
}

export interface BaoDpRatesStorage {
  list(filters: BaoDpRateFilters): Promise<BaoDpRateWithBenefit[]>;
  get(id: string): Promise<BaoDpRate | undefined>;
  /**
   * The effective rate for a benefit + tier transition as of a date:
   * the row with the greatest effective_ymd <= asOfYmd, or undefined.
   * No fallback — when no effective-dated rate applies, nothing is returned.
   */
  getEffectiveRate(
    benefitId: string,
    tierTransition: BaoDpTierTransition,
    asOfYmd: string,
  ): Promise<BaoDpRate | undefined>;
  create(entry: InsertBaoDpRate): Promise<BaoDpRate>;
  update(
    id: string,
    record: Partial<
      Pick<
        InsertBaoDpRate,
        "benefitId" | "tierTransition" | "rate" | "effectiveYmd" | "provisional"
      >
    >,
  ): Promise<BaoDpRate | undefined>;
  delete(id: string): Promise<boolean>;
  tableExists(): Promise<boolean>;
}

/**
 * Error message thrown when a family_to_family_dp row would end up
 * non-provisional. That transition has no confirmed business rule; its rows
 * are placeholders and must never be presented as confirmed values.
 */
export const DP_PLACEHOLDER_MUST_BE_PROVISIONAL =
  "DP_PLACEHOLDER_MUST_BE_PROVISIONAL";

const tableName = getTableName(sitespecificBaoDpRates);
const rates = sitespecificBaoDpRates;

const enrichedSelection = {
  id: rates.id,
  benefitId: rates.benefitId,
  tierTransition: rates.tierTransition,
  rate: rates.rate,
  effectiveYmd: rates.effectiveYmd,
  provisional: rates.provisional,
  data: rates.data,
  benefitName: trustBenefits.name,
};

export function createBaoDpRatesStorage(): BaoDpRatesStorage {
  return {
    async tableExists(): Promise<boolean> {
      return tableExistsUtil(tableName);
    },

    async list(filters: BaoDpRateFilters): Promise<BaoDpRateWithBenefit[]> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      const client = getClient();
      const conditions = [];
      if (filters.benefitId) {
        conditions.push(eq(rates.benefitId, filters.benefitId));
      }
      if (filters.tierTransition) {
        conditions.push(eq(rates.tierTransition, filters.tierTransition));
      }
      const rows = await client
        .select(enrichedSelection)
        .from(rates)
        .leftJoin(trustBenefits, eq(trustBenefits.id, rates.benefitId))
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(
          asc(trustBenefits.name),
          asc(rates.tierTransition),
          desc(rates.effectiveYmd),
        );
      return rows as BaoDpRateWithBenefit[];
    },

    async get(id: string): Promise<BaoDpRate | undefined> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      const client = getClient();
      const results = await client.select().from(rates).where(eq(rates.id, id));
      return results[0];
    },

    async getEffectiveRate(
      benefitId: string,
      tierTransition: BaoDpTierTransition,
      asOfYmd: string,
    ): Promise<BaoDpRate | undefined> {
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
            eq(rates.tierTransition, tierTransition),
            lte(rates.effectiveYmd, asOfYmd),
          ),
        )
        .orderBy(desc(rates.effectiveYmd))
        .limit(1);
      return results[0];
    },

    async create(entry: InsertBaoDpRate): Promise<BaoDpRate> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      if (
        entry.tierTransition === "family_to_family_dp" &&
        entry.provisional === false
      ) {
        throw new Error(DP_PLACEHOLDER_MUST_BE_PROVISIONAL);
      }
      const client = getClient();
      const results = await client
        .insert(rates)
        .values(
          entry.tierTransition === "family_to_family_dp"
            ? { ...entry, provisional: true }
            : entry,
        )
        .returning();
      return results[0];
    },

    async update(
      id: string,
      record: Partial<
        Pick<
          InsertBaoDpRate,
          "benefitId" | "tierTransition" | "rate" | "effectiveYmd" | "provisional"
        >
      >,
    ): Promise<BaoDpRate | undefined> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      const client = getClient();
      const existing = await this.get(id);
      if (!existing) return undefined;
      const finalTransition = record.tierTransition ?? existing.tierTransition;
      const finalProvisional = record.provisional ?? existing.provisional;
      if (finalTransition === "family_to_family_dp" && !finalProvisional) {
        throw new Error(DP_PLACEHOLDER_MUST_BE_PROVISIONAL);
      }
      const results = await client
        .update(rates)
        .set(
          finalTransition === "family_to_family_dp"
            ? { ...record, provisional: true }
            : record,
        )
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

export const baoDpRatesLoggingConfig: StorageLoggingConfig<BaoDpRatesStorage> = {
  module: 'sitespecific.bao.dp-rates',
  methods: {
    create: {
      enabled: true,
      getEntityId: (args, result) => result?.id,
      getDescription: (args, result) =>
        `Created DP rate ${result?.rate} (transition ${result?.tierTransition}) effective ${result?.effectiveYmd}`,
    },
    update: {
      enabled: true,
      before: async (args, storage) => storage.get(args[0]),
      getEntityId: (args) => args[0],
      getDescription: (args, result) =>
        `Updated DP rate to ${result?.rate} (transition ${result?.tierTransition}) effective ${result?.effectiveYmd}`,
    },
    delete: {
      enabled: true,
      before: async (args, storage) => storage.get(args[0]),
      getEntityId: (args) => args[0],
      getDescription: () => `Deleted DP rate entry`,
    },
  },
};
