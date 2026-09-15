import { getClient } from "../../transaction-context";
import { and, asc, desc, eq, getTableName, lte } from "drizzle-orm";
import { tableExists as tableExistsUtil } from "../../utils";
import {
  createBaoEeContributionRateRequestSchema,
  listBaoEeContributionRatesQuerySchema,
  sitespecificBaoEeContributionRates,
  trustBenefits,
  updateBaoEeContributionRateRequestSchema,
  type BaoEeContributionRate,
  type BaoEeContributionRateWithBenefit,
  type InsertBaoEeContributionRate,
} from "@shared/schema";
import type { StorageLoggingConfig } from "../../middleware/logging";

export type {
  BaoEeContributionRate,
  BaoEeContributionRateWithBenefit,
  InsertBaoEeContributionRate,
};

export interface BaoEeContributionRateFilters {
  policyId: string;
  benefitId?: string;
}

export interface BaoEeContributionRatesStorage {
  list(filters: BaoEeContributionRateFilters): Promise<BaoEeContributionRateWithBenefit[]>;
  get(id: string): Promise<BaoEeContributionRate | undefined>;
  /**
   * Gets the rate with the greatest effective date on or before asOfYmd.
   * Undefined means no configuration exists; an explicit "0.00" is returned.
   */
  getEffectiveRate(
    policyId: string,
    benefitId: string,
    asOfYmd: string,
  ): Promise<BaoEeContributionRate | undefined>;
  create(entry: InsertBaoEeContributionRate): Promise<BaoEeContributionRate>;
  update(
    id: string,
    record: Partial<Pick<InsertBaoEeContributionRate, "benefitId" | "rate" | "effectiveYmd">>,
  ): Promise<BaoEeContributionRate | undefined>;
  delete(id: string): Promise<boolean>;
  tableExists(): Promise<boolean>;
}

const tableName = getTableName(sitespecificBaoEeContributionRates);
const rates = sitespecificBaoEeContributionRates;

const enrichedSelection = {
  id: rates.id,
  policyId: rates.policyId,
  benefitId: rates.benefitId,
  rate: rates.rate,
  effectiveYmd: rates.effectiveYmd,
  benefitName: trustBenefits.name,
};

export function createBaoEeContributionRatesStorage(): BaoEeContributionRatesStorage {
  return {
    async tableExists(): Promise<boolean> {
      return tableExistsUtil(tableName);
    },

    async list(filters: BaoEeContributionRateFilters): Promise<BaoEeContributionRateWithBenefit[]> {
      if (!(await this.tableExists())) throw new Error("COMPONENT_TABLE_NOT_FOUND");
      const parsed = listBaoEeContributionRatesQuerySchema.parse(filters);
      const conditions = [eq(rates.policyId, parsed.policyId)];
      if (parsed.benefitId) conditions.push(eq(rates.benefitId, parsed.benefitId));
      const client = getClient();
      const rows = await client
        .select(enrichedSelection)
        .from(rates)
        .leftJoin(trustBenefits, eq(trustBenefits.id, rates.benefitId))
        .where(and(...conditions))
        .orderBy(asc(trustBenefits.name), desc(rates.effectiveYmd));
      return rows as BaoEeContributionRateWithBenefit[];
    },

    async get(id: string): Promise<BaoEeContributionRate | undefined> {
      if (!(await this.tableExists())) throw new Error("COMPONENT_TABLE_NOT_FOUND");
      const client = getClient();
      const rows = await client.select().from(rates).where(eq(rates.id, id));
      return rows[0];
    },

    async getEffectiveRate(
      policyId: string,
      benefitId: string,
      asOfYmd: string,
    ): Promise<BaoEeContributionRate | undefined> {
      if (!(await this.tableExists())) throw new Error("COMPONENT_TABLE_NOT_FOUND");
      const client = getClient();
      const rows = await client
        .select()
        .from(rates)
        .where(
          and(
            eq(rates.policyId, policyId),
            eq(rates.benefitId, benefitId),
            lte(rates.effectiveYmd, asOfYmd),
          ),
        )
        .orderBy(desc(rates.effectiveYmd))
        .limit(1);
      return rows[0];
    },

    async create(entry: InsertBaoEeContributionRate): Promise<BaoEeContributionRate> {
      if (!(await this.tableExists())) throw new Error("COMPONENT_TABLE_NOT_FOUND");
      const parsed = createBaoEeContributionRateRequestSchema.parse(entry);
      const client = getClient();
      const rows = await client.insert(rates).values(parsed).returning();
      return rows[0];
    },

    async update(
      id: string,
      record: Partial<Pick<InsertBaoEeContributionRate, "benefitId" | "rate" | "effectiveYmd">>,
    ): Promise<BaoEeContributionRate | undefined> {
      if (!(await this.tableExists())) throw new Error("COMPONENT_TABLE_NOT_FOUND");
      const parsed = updateBaoEeContributionRateRequestSchema.parse(record);
      const client = getClient();
      const rows = await client.update(rates).set(parsed).where(eq(rates.id, id)).returning();
      return rows[0];
    },

    async delete(id: string): Promise<boolean> {
      if (!(await this.tableExists())) throw new Error("COMPONENT_TABLE_NOT_FOUND");
      const client = getClient();
      const rows = await client.delete(rates).where(eq(rates.id, id)).returning({ id: rates.id });
      return rows.length > 0;
    },
  };
}

export const baoEeContributionRatesLoggingConfig: StorageLoggingConfig<BaoEeContributionRatesStorage> = {
  module: "sitespecific.bao.ee-contribution-rates",
  table: "sitespecific_bao_ee_contribution_rates",
  // Contribution rates are maintained from a policy page.  Touch the policy's
  // provenance sidecar as well as recording the rate row's own audit history.
  hostTable: "policies",
  hostEntityId: (_args, result, before) => result?.policyId ?? before?.policyId,
  methods: {
    create: {
      enabled: true,
      getEntityId: (_args, result) => result?.id,
      getDescription: (_args, result) =>
        `Created employee contribution rate ${result?.rate} for policy ${result?.policyId}, benefit ${result?.benefitId}, effective ${result?.effectiveYmd}`,
    },
    update: {
      enabled: true,
      before: async (args, storage) => storage.get(args[0]),
      getEntityId: (args) => args[0],
      getDescription: (_args, result) =>
        `Updated employee contribution rate to ${result?.rate} for benefit ${result?.benefitId}, effective ${result?.effectiveYmd}`,
    },
    delete: {
      enabled: true,
      before: async (args, storage) => storage.get(args[0]),
      getEntityId: (args) => args[0],
      getDescription: () => "Deleted employee contribution rate entry",
    },
  },
};