import { getClient } from '../../transaction-context';
import { eq, and, desc, lte } from "drizzle-orm";
import { tableExists as tableExistsUtil } from "../../utils";
import {
  gbhetPensionBenefitSchedules,
  type GbhetPensionBenefitSchedule,
  type InsertGbhetPensionBenefitSchedule,
  gbhetPensionAccrualTiers,
  type GbhetPensionAccrualTier,
  type InsertGbhetPensionAccrualTier,
  gbhetPensionAnnualSummary,
  type GbhetPensionAnnualSummary,
  type InsertGbhetPensionAnnualSummary,
  gbhetPensionShareValues,
  type GbhetPensionShareValue,
  type InsertGbhetPensionShareValue,
  gbhetPensionPlanYears,
  type GbhetPensionPlanYear,
  type InsertGbhetPensionPlanYear,
  gbhetPensionEmployerPlans,
  type GbhetPensionEmployerPlan,
  type InsertGbhetPensionEmployerPlan,
  gbhetPensionAiFactors,
  type GbhetPensionAiFactor,
  type InsertGbhetPensionAiFactor,
  gbhetPensionPayoutFactors,
  type GbhetPensionPayoutFactor,
  type InsertGbhetPensionPayoutFactor,
  gbhetPensionEarlyRetirementFactors,
  type GbhetPensionEarlyRetirementFactor,
  type InsertGbhetPensionEarlyRetirementFactor,
  gbhetPensionInterestRates,
  type GbhetPensionInterestRate,
  type InsertGbhetPensionInterestRate,
} from "../../../../shared/schema/sitespecific/gbhet-pension/schema";
import { employers } from "../../../../shared/schema";
import { getTableName } from "drizzle-orm";

export type {
  GbhetPensionBenefitSchedule,
  InsertGbhetPensionBenefitSchedule,
  GbhetPensionAccrualTier,
  InsertGbhetPensionAccrualTier,
  GbhetPensionAnnualSummary,
  InsertGbhetPensionAnnualSummary,
  GbhetPensionShareValue,
  InsertGbhetPensionShareValue,
  GbhetPensionPlanYear,
  InsertGbhetPensionPlanYear,
  GbhetPensionEmployerPlan,
  InsertGbhetPensionEmployerPlan,
  GbhetPensionAiFactor,
  InsertGbhetPensionAiFactor,
  GbhetPensionPayoutFactor,
  InsertGbhetPensionPayoutFactor,
  GbhetPensionEarlyRetirementFactor,
  InsertGbhetPensionEarlyRetirementFactor,
  GbhetPensionInterestRate,
  InsertGbhetPensionInterestRate,
};

export interface GbhetPensionBenefitSchedulesStorage {
  getAll(): Promise<GbhetPensionBenefitSchedule[]>;
  get(id: string): Promise<GbhetPensionBenefitSchedule | undefined>;
  getByYear(year: number): Promise<GbhetPensionBenefitSchedule | undefined>;
  getByYearAndPlan(year: number, plan: string): Promise<GbhetPensionBenefitSchedule | undefined>;
  create(record: InsertGbhetPensionBenefitSchedule): Promise<GbhetPensionBenefitSchedule>;
  update(id: string, record: Partial<InsertGbhetPensionBenefitSchedule>): Promise<GbhetPensionBenefitSchedule | undefined>;
  delete(id: string): Promise<boolean>;
  tableExists(): Promise<boolean>;
}

export interface GbhetPensionAccrualTiersStorage {
  getAll(): Promise<GbhetPensionAccrualTier[]>;
  get(id: string): Promise<GbhetPensionAccrualTier | undefined>;
  getByYear(year: number): Promise<GbhetPensionAccrualTier[]>;
  getEffectiveTiersForYear(year: number): Promise<GbhetPensionAccrualTier[]>;
  create(record: InsertGbhetPensionAccrualTier): Promise<GbhetPensionAccrualTier>;
  update(id: string, record: Partial<InsertGbhetPensionAccrualTier>): Promise<GbhetPensionAccrualTier | undefined>;
  delete(id: string): Promise<boolean>;
  tableExists(): Promise<boolean>;
}

export interface GbhetPensionAnnualSummaryStorage {
  getAll(): Promise<GbhetPensionAnnualSummary[]>;
  get(id: string): Promise<GbhetPensionAnnualSummary | undefined>;
  getByWorkerAndYear(workerId: string, year: number): Promise<GbhetPensionAnnualSummary | undefined>;
  getByWorker(workerId: string): Promise<GbhetPensionAnnualSummary[]>;
  getByYear(year: number): Promise<GbhetPensionAnnualSummary[]>;
  upsert(record: InsertGbhetPensionAnnualSummary): Promise<GbhetPensionAnnualSummary>;
  create(record: InsertGbhetPensionAnnualSummary): Promise<GbhetPensionAnnualSummary>;
  update(id: string, record: Partial<InsertGbhetPensionAnnualSummary>): Promise<GbhetPensionAnnualSummary | undefined>;
  delete(id: string): Promise<boolean>;
  tableExists(): Promise<boolean>;
}

export interface GbhetPensionShareValuesStorage {
  getAll(): Promise<GbhetPensionShareValue[]>;
  get(id: string): Promise<GbhetPensionShareValue | undefined>;
  getCurrentValue(date: string): Promise<GbhetPensionShareValue | undefined>;
  create(record: InsertGbhetPensionShareValue): Promise<GbhetPensionShareValue>;
  update(id: string, record: Partial<InsertGbhetPensionShareValue>): Promise<GbhetPensionShareValue | undefined>;
  delete(id: string): Promise<boolean>;
  tableExists(): Promise<boolean>;
}

export interface GbhetPensionPlanYearsStorage {
  getAll(): Promise<GbhetPensionPlanYear[]>;
  get(id: string): Promise<GbhetPensionPlanYear | undefined>;
  getByYear(year: number): Promise<GbhetPensionPlanYear | undefined>;
  create(record: InsertGbhetPensionPlanYear): Promise<GbhetPensionPlanYear>;
  update(id: string, record: Partial<InsertGbhetPensionPlanYear>): Promise<GbhetPensionPlanYear | undefined>;
  delete(id: string): Promise<boolean>;
  tableExists(): Promise<boolean>;
}

export interface GbhetPensionEmployerPlansStorage {
  getAll(): Promise<(GbhetPensionEmployerPlan & { employerName: string })[]>;
  get(id: string): Promise<GbhetPensionEmployerPlan | undefined>;
  getByEmployerId(employerId: string): Promise<GbhetPensionEmployerPlan | undefined>;
  upsert(record: InsertGbhetPensionEmployerPlan): Promise<GbhetPensionEmployerPlan>;
  delete(id: string): Promise<boolean>;
  tableExists(): Promise<boolean>;
}

export interface GbhetPensionAiFactorsStorage {
  getAll(): Promise<GbhetPensionAiFactor[]>;
  get(id: string): Promise<GbhetPensionAiFactor | undefined>;
  getByAge(age: number): Promise<GbhetPensionAiFactor | undefined>;
  upsert(record: InsertGbhetPensionAiFactor): Promise<GbhetPensionAiFactor>;
  delete(id: string): Promise<boolean>;
  deleteAll(): Promise<number>;
  tableExists(): Promise<boolean>;
}

export interface GbhetPensionPayoutFactorsStorage {
  getAll(): Promise<GbhetPensionPayoutFactor[]>;
  getByElectionType(electionType: string): Promise<GbhetPensionPayoutFactor[]>;
  getByElectionTypeAndYear(electionType: string, factorYear: number): Promise<GbhetPensionPayoutFactor[]>;
  lookup(electionType: string, subscriberAge: number, beneficiaryAge: number | null, factorYear: number): Promise<GbhetPensionPayoutFactor | undefined>;
  upsert(record: InsertGbhetPensionPayoutFactor): Promise<GbhetPensionPayoutFactor>;
  delete(id: string): Promise<boolean>;
  deleteByElectionType(electionType: string): Promise<number>;
  deleteByElectionTypeAndYear(electionType: string, factorYear: number): Promise<number>;
  deleteAll(): Promise<number>;
  tableExists(): Promise<boolean>;
}

export interface GbhetPensionEarlyRetirementFactorsStorage {
  getAll(): Promise<GbhetPensionEarlyRetirementFactor[]>;
  getByReason(reason: string): Promise<GbhetPensionEarlyRetirementFactor | undefined>;
  upsert(record: InsertGbhetPensionEarlyRetirementFactor): Promise<GbhetPensionEarlyRetirementFactor>;
  delete(id: string): Promise<boolean>;
  deleteAll(): Promise<number>;
  tableExists(): Promise<boolean>;
}

export interface GbhetPensionInterestRatesStorage {
  getAll(): Promise<GbhetPensionInterestRate[]>;
  getByYear(year: number): Promise<GbhetPensionInterestRate | undefined>;
  upsert(record: InsertGbhetPensionInterestRate): Promise<GbhetPensionInterestRate>;
  delete(id: string): Promise<boolean>;
  deleteAll(): Promise<number>;
  tableExists(): Promise<boolean>;
}

export interface GbhetPensionStorage {
  benefitSchedules: GbhetPensionBenefitSchedulesStorage;
  accrualTiers: GbhetPensionAccrualTiersStorage;
  annualSummary: GbhetPensionAnnualSummaryStorage;
  shareValues: GbhetPensionShareValuesStorage;
  planYears: GbhetPensionPlanYearsStorage;
  employerPlans: GbhetPensionEmployerPlansStorage;
  aiFactors: GbhetPensionAiFactorsStorage;
  payoutFactors: GbhetPensionPayoutFactorsStorage;
  earlyRetirementFactors: GbhetPensionEarlyRetirementFactorsStorage;
  interestRates: GbhetPensionInterestRatesStorage;
}

const benefitSchedulesTableName = getTableName(gbhetPensionBenefitSchedules);
const accrualTiersTableName = getTableName(gbhetPensionAccrualTiers);
const annualSummaryTableName = getTableName(gbhetPensionAnnualSummary);
const aiFactorsTableName = getTableName(gbhetPensionAiFactors);
const payoutFactorsTableName = getTableName(gbhetPensionPayoutFactors);
const earlyRetirementFactorsTableName = getTableName(gbhetPensionEarlyRetirementFactors);
const interestRatesTableName = getTableName(gbhetPensionInterestRates);
const shareValuesTableName = getTableName(gbhetPensionShareValues);
const planYearsTableName = getTableName(gbhetPensionPlanYears);
const employerPlansTableName = getTableName(gbhetPensionEmployerPlans);

export function createGbhetPensionStorage(): GbhetPensionStorage {
  return {
    benefitSchedules: {
      async tableExists(): Promise<boolean> {
        return tableExistsUtil(benefitSchedulesTableName);
      },

      async getAll(): Promise<GbhetPensionBenefitSchedule[]> {
        if (!(await this.tableExists())) {
          throw new Error("COMPONENT_TABLE_NOT_FOUND");
        }
        const client = getClient();
        return client
          .select()
          .from(gbhetPensionBenefitSchedules)
          .orderBy(gbhetPensionBenefitSchedules.year);
      },

      async get(id: string): Promise<GbhetPensionBenefitSchedule | undefined> {
        if (!(await this.tableExists())) {
          throw new Error("COMPONENT_TABLE_NOT_FOUND");
        }
        const client = getClient();
        const results = await client
          .select()
          .from(gbhetPensionBenefitSchedules)
          .where(eq(gbhetPensionBenefitSchedules.id, id));
        return results[0];
      },

      async getByYear(year: number): Promise<GbhetPensionBenefitSchedule | undefined> {
        if (!(await this.tableExists())) {
          throw new Error("COMPONENT_TABLE_NOT_FOUND");
        }
        const client = getClient();
        const results = await client
          .select()
          .from(gbhetPensionBenefitSchedules)
          .where(eq(gbhetPensionBenefitSchedules.year, year));
        return results[0];
      },

      async getByYearAndPlan(year: number, plan: string): Promise<GbhetPensionBenefitSchedule | undefined> {
        if (!(await this.tableExists())) {
          throw new Error("COMPONENT_TABLE_NOT_FOUND");
        }
        const client = getClient();
        const results = await client
          .select()
          .from(gbhetPensionBenefitSchedules)
          .where(and(
            eq(gbhetPensionBenefitSchedules.year, year),
            eq(gbhetPensionBenefitSchedules.plan, plan)
          ));
        return results[0];
      },

      async create(record: InsertGbhetPensionBenefitSchedule): Promise<GbhetPensionBenefitSchedule> {
        if (!(await this.tableExists())) {
          throw new Error("COMPONENT_TABLE_NOT_FOUND");
        }
        const client = getClient();
        const results = await client
          .insert(gbhetPensionBenefitSchedules)
          .values(record)
          .returning();
        return results[0];
      },

      async update(id: string, record: Partial<InsertGbhetPensionBenefitSchedule>): Promise<GbhetPensionBenefitSchedule | undefined> {
        if (!(await this.tableExists())) {
          throw new Error("COMPONENT_TABLE_NOT_FOUND");
        }
        const client = getClient();
        const results = await client
          .update(gbhetPensionBenefitSchedules)
          .set(record)
          .where(eq(gbhetPensionBenefitSchedules.id, id))
          .returning();
        return results[0];
      },

      async delete(id: string): Promise<boolean> {
        if (!(await this.tableExists())) {
          throw new Error("COMPONENT_TABLE_NOT_FOUND");
        }
        const client = getClient();
        const results = await client
          .delete(gbhetPensionBenefitSchedules)
          .where(eq(gbhetPensionBenefitSchedules.id, id))
          .returning({ id: gbhetPensionBenefitSchedules.id });
        return results.length > 0;
      },
    },

    accrualTiers: {
      async tableExists(): Promise<boolean> {
        return tableExistsUtil(accrualTiersTableName);
      },

      async getAll(): Promise<GbhetPensionAccrualTier[]> {
        if (!(await this.tableExists())) {
          throw new Error("COMPONENT_TABLE_NOT_FOUND");
        }
        const client = getClient();
        return client
          .select()
          .from(gbhetPensionAccrualTiers)
          .orderBy(gbhetPensionAccrualTiers.year, gbhetPensionAccrualTiers.minHours);
      },

      async get(id: string): Promise<GbhetPensionAccrualTier | undefined> {
        if (!(await this.tableExists())) {
          throw new Error("COMPONENT_TABLE_NOT_FOUND");
        }
        const client = getClient();
        const results = await client
          .select()
          .from(gbhetPensionAccrualTiers)
          .where(eq(gbhetPensionAccrualTiers.id, id));
        return results[0];
      },

      async getByYear(year: number): Promise<GbhetPensionAccrualTier[]> {
        if (!(await this.tableExists())) {
          throw new Error("COMPONENT_TABLE_NOT_FOUND");
        }
        const client = getClient();
        return client
          .select()
          .from(gbhetPensionAccrualTiers)
          .where(eq(gbhetPensionAccrualTiers.year, year))
          .orderBy(gbhetPensionAccrualTiers.minHours);
      },

      async getEffectiveTiersForYear(targetYear: number): Promise<GbhetPensionAccrualTier[]> {
        if (!(await this.tableExists())) {
          throw new Error("COMPONENT_TABLE_NOT_FOUND");
        }
        const client = getClient();
        const allTiers = await client
          .select()
          .from(gbhetPensionAccrualTiers)
          .orderBy(desc(gbhetPensionAccrualTiers.year), gbhetPensionAccrualTiers.minHours);

        const distinctYears = Array.from(new Set(allTiers.map(t => t.year))).sort((a, b) => b - a);
        const effectiveYear = distinctYears.find(y => y <= targetYear);
        if (effectiveYear === undefined) return [];

        return allTiers
          .filter(t => t.year === effectiveYear)
          .sort((a, b) => parseFloat(a.minHours) - parseFloat(b.minHours));
      },

      async create(record: InsertGbhetPensionAccrualTier): Promise<GbhetPensionAccrualTier> {
        if (!(await this.tableExists())) {
          throw new Error("COMPONENT_TABLE_NOT_FOUND");
        }
        const client = getClient();
        const results = await client
          .insert(gbhetPensionAccrualTiers)
          .values(record)
          .returning();
        return results[0];
      },

      async update(id: string, record: Partial<InsertGbhetPensionAccrualTier>): Promise<GbhetPensionAccrualTier | undefined> {
        if (!(await this.tableExists())) {
          throw new Error("COMPONENT_TABLE_NOT_FOUND");
        }
        const client = getClient();
        const results = await client
          .update(gbhetPensionAccrualTiers)
          .set(record)
          .where(eq(gbhetPensionAccrualTiers.id, id))
          .returning();
        return results[0];
      },

      async delete(id: string): Promise<boolean> {
        if (!(await this.tableExists())) {
          throw new Error("COMPONENT_TABLE_NOT_FOUND");
        }
        const client = getClient();
        const results = await client
          .delete(gbhetPensionAccrualTiers)
          .where(eq(gbhetPensionAccrualTiers.id, id))
          .returning({ id: gbhetPensionAccrualTiers.id });
        return results.length > 0;
      },
    },

    annualSummary: {
      async tableExists(): Promise<boolean> {
        return tableExistsUtil(annualSummaryTableName);
      },

      async getAll(): Promise<GbhetPensionAnnualSummary[]> {
        if (!(await this.tableExists())) {
          throw new Error("COMPONENT_TABLE_NOT_FOUND");
        }
        const client = getClient();
        return client
          .select()
          .from(gbhetPensionAnnualSummary);
      },

      async get(id: string): Promise<GbhetPensionAnnualSummary | undefined> {
        if (!(await this.tableExists())) {
          throw new Error("COMPONENT_TABLE_NOT_FOUND");
        }
        const client = getClient();
        const results = await client
          .select()
          .from(gbhetPensionAnnualSummary)
          .where(eq(gbhetPensionAnnualSummary.id, id));
        return results[0];
      },

      async getByWorkerAndYear(workerId: string, year: number): Promise<GbhetPensionAnnualSummary | undefined> {
        if (!(await this.tableExists())) {
          throw new Error("COMPONENT_TABLE_NOT_FOUND");
        }
        const client = getClient();
        const results = await client
          .select()
          .from(gbhetPensionAnnualSummary)
          .where(and(
            eq(gbhetPensionAnnualSummary.workerId, workerId),
            eq(gbhetPensionAnnualSummary.year, year),
          ));
        return results[0];
      },

      async getByWorker(workerId: string): Promise<GbhetPensionAnnualSummary[]> {
        if (!(await this.tableExists())) {
          throw new Error("COMPONENT_TABLE_NOT_FOUND");
        }
        const client = getClient();
        return client
          .select()
          .from(gbhetPensionAnnualSummary)
          .where(eq(gbhetPensionAnnualSummary.workerId, workerId))
          .orderBy(gbhetPensionAnnualSummary.year);
      },

      async getByYear(year: number): Promise<GbhetPensionAnnualSummary[]> {
        if (!(await this.tableExists())) {
          throw new Error("COMPONENT_TABLE_NOT_FOUND");
        }
        const client = getClient();
        return client
          .select()
          .from(gbhetPensionAnnualSummary)
          .where(eq(gbhetPensionAnnualSummary.year, year));
      },

      async upsert(record: InsertGbhetPensionAnnualSummary): Promise<GbhetPensionAnnualSummary> {
        if (!(await this.tableExists())) {
          throw new Error("COMPONENT_TABLE_NOT_FOUND");
        }
        const client = getClient();
        const results = await client
          .insert(gbhetPensionAnnualSummary)
          .values(record)
          .onConflictDoUpdate({
            target: [gbhetPensionAnnualSummary.workerId, gbhetPensionAnnualSummary.year],
            set: {
              totalPensionHours: record.totalPensionHours,
              classificationId: record.classificationId,
              isSpecialDesignation: record.isSpecialDesignation,
              tierId: record.tierId,
              accrualPct: record.accrualPct,
              monthlyBenefitRate: record.monthlyBenefitRate,
              annualAccrual: record.annualAccrual,
              qualified: record.qualified,
              qualificationThresholdHours: record.qualificationThresholdHours,
              data: record.data,
            },
          })
          .returning();
        return results[0];
      },

      async create(record: InsertGbhetPensionAnnualSummary): Promise<GbhetPensionAnnualSummary> {
        if (!(await this.tableExists())) {
          throw new Error("COMPONENT_TABLE_NOT_FOUND");
        }
        const client = getClient();
        const results = await client
          .insert(gbhetPensionAnnualSummary)
          .values(record)
          .returning();
        return results[0];
      },

      async update(id: string, record: Partial<InsertGbhetPensionAnnualSummary>): Promise<GbhetPensionAnnualSummary | undefined> {
        if (!(await this.tableExists())) {
          throw new Error("COMPONENT_TABLE_NOT_FOUND");
        }
        const client = getClient();
        const results = await client
          .update(gbhetPensionAnnualSummary)
          .set(record)
          .where(eq(gbhetPensionAnnualSummary.id, id))
          .returning();
        return results[0];
      },

      async delete(id: string): Promise<boolean> {
        if (!(await this.tableExists())) {
          throw new Error("COMPONENT_TABLE_NOT_FOUND");
        }
        const client = getClient();
        const results = await client
          .delete(gbhetPensionAnnualSummary)
          .where(eq(gbhetPensionAnnualSummary.id, id))
          .returning({ id: gbhetPensionAnnualSummary.id });
        return results.length > 0;
      },
    },

    shareValues: {
      async tableExists(): Promise<boolean> {
        return tableExistsUtil(shareValuesTableName);
      },

      async getAll(): Promise<GbhetPensionShareValue[]> {
        if (!(await this.tableExists())) {
          throw new Error("COMPONENT_TABLE_NOT_FOUND");
        }
        const client = getClient();
        return client
          .select()
          .from(gbhetPensionShareValues)
          .orderBy(desc(gbhetPensionShareValues.effectiveDate));
      },

      async get(id: string): Promise<GbhetPensionShareValue | undefined> {
        if (!(await this.tableExists())) {
          throw new Error("COMPONENT_TABLE_NOT_FOUND");
        }
        const client = getClient();
        const results = await client
          .select()
          .from(gbhetPensionShareValues)
          .where(eq(gbhetPensionShareValues.id, id));
        return results[0];
      },

      async getCurrentValue(date: string): Promise<GbhetPensionShareValue | undefined> {
        if (!(await this.tableExists())) {
          throw new Error("COMPONENT_TABLE_NOT_FOUND");
        }
        const client = getClient();
        const results = await client
          .select()
          .from(gbhetPensionShareValues)
          .where(lte(gbhetPensionShareValues.effectiveDate, date))
          .orderBy(desc(gbhetPensionShareValues.effectiveDate))
          .limit(1);
        return results[0];
      },

      async create(record: InsertGbhetPensionShareValue): Promise<GbhetPensionShareValue> {
        if (!(await this.tableExists())) {
          throw new Error("COMPONENT_TABLE_NOT_FOUND");
        }
        const client = getClient();
        const results = await client
          .insert(gbhetPensionShareValues)
          .values(record)
          .returning();
        return results[0];
      },

      async update(id: string, record: Partial<InsertGbhetPensionShareValue>): Promise<GbhetPensionShareValue | undefined> {
        if (!(await this.tableExists())) {
          throw new Error("COMPONENT_TABLE_NOT_FOUND");
        }
        const client = getClient();
        const results = await client
          .update(gbhetPensionShareValues)
          .set(record)
          .where(eq(gbhetPensionShareValues.id, id))
          .returning();
        return results[0];
      },

      async delete(id: string): Promise<boolean> {
        if (!(await this.tableExists())) {
          throw new Error("COMPONENT_TABLE_NOT_FOUND");
        }
        const client = getClient();
        const results = await client
          .delete(gbhetPensionShareValues)
          .where(eq(gbhetPensionShareValues.id, id))
          .returning({ id: gbhetPensionShareValues.id });
        return results.length > 0;
      },
    },

    planYears: {
      async tableExists(): Promise<boolean> {
        return tableExistsUtil(planYearsTableName);
      },

      async getAll(): Promise<GbhetPensionPlanYear[]> {
        if (!(await this.tableExists())) {
          throw new Error("COMPONENT_TABLE_NOT_FOUND");
        }
        const client = getClient();
        return client
          .select()
          .from(gbhetPensionPlanYears)
          .orderBy(desc(gbhetPensionPlanYears.year));
      },

      async get(id: string): Promise<GbhetPensionPlanYear | undefined> {
        if (!(await this.tableExists())) {
          throw new Error("COMPONENT_TABLE_NOT_FOUND");
        }
        const client = getClient();
        const results = await client
          .select()
          .from(gbhetPensionPlanYears)
          .where(eq(gbhetPensionPlanYears.id, id));
        return results[0];
      },

      async getByYear(year: number): Promise<GbhetPensionPlanYear | undefined> {
        if (!(await this.tableExists())) {
          throw new Error("COMPONENT_TABLE_NOT_FOUND");
        }
        const client = getClient();
        const results = await client
          .select()
          .from(gbhetPensionPlanYears)
          .where(eq(gbhetPensionPlanYears.year, year));
        return results[0];
      },

      async create(record: InsertGbhetPensionPlanYear): Promise<GbhetPensionPlanYear> {
        if (!(await this.tableExists())) {
          throw new Error("COMPONENT_TABLE_NOT_FOUND");
        }
        const client = getClient();
        const results = await client
          .insert(gbhetPensionPlanYears)
          .values(record)
          .returning();
        return results[0];
      },

      async update(id: string, record: Partial<InsertGbhetPensionPlanYear>): Promise<GbhetPensionPlanYear | undefined> {
        if (!(await this.tableExists())) {
          throw new Error("COMPONENT_TABLE_NOT_FOUND");
        }
        const client = getClient();
        const results = await client
          .update(gbhetPensionPlanYears)
          .set(record)
          .where(eq(gbhetPensionPlanYears.id, id))
          .returning();
        return results[0];
      },

      async delete(id: string): Promise<boolean> {
        if (!(await this.tableExists())) {
          throw new Error("COMPONENT_TABLE_NOT_FOUND");
        }
        const client = getClient();
        const results = await client
          .delete(gbhetPensionPlanYears)
          .where(eq(gbhetPensionPlanYears.id, id))
          .returning({ id: gbhetPensionPlanYears.id });
        return results.length > 0;
      },
    },

    employerPlans: {
      async tableExists(): Promise<boolean> {
        return tableExistsUtil(employerPlansTableName);
      },

      async getAll(): Promise<(GbhetPensionEmployerPlan & { employerName: string })[]> {
        if (!(await this.tableExists())) {
          throw new Error("COMPONENT_TABLE_NOT_FOUND");
        }
        const client = getClient();
        const results = await client
          .select({
            id: gbhetPensionEmployerPlans.id,
            employerId: gbhetPensionEmployerPlans.employerId,
            plan: gbhetPensionEmployerPlans.plan,
            data: gbhetPensionEmployerPlans.data,
            employerName: employers.name,
          })
          .from(gbhetPensionEmployerPlans)
          .innerJoin(employers, eq(gbhetPensionEmployerPlans.employerId, employers.id))
          .orderBy(employers.name);
        return results;
      },

      async get(id: string): Promise<GbhetPensionEmployerPlan | undefined> {
        if (!(await this.tableExists())) {
          throw new Error("COMPONENT_TABLE_NOT_FOUND");
        }
        const client = getClient();
        const results = await client
          .select()
          .from(gbhetPensionEmployerPlans)
          .where(eq(gbhetPensionEmployerPlans.id, id));
        return results[0];
      },

      async getByEmployerId(employerId: string): Promise<GbhetPensionEmployerPlan | undefined> {
        if (!(await this.tableExists())) {
          throw new Error("COMPONENT_TABLE_NOT_FOUND");
        }
        const client = getClient();
        const results = await client
          .select()
          .from(gbhetPensionEmployerPlans)
          .where(eq(gbhetPensionEmployerPlans.employerId, employerId));
        return results[0];
      },

      async upsert(record: InsertGbhetPensionEmployerPlan): Promise<GbhetPensionEmployerPlan> {
        if (!(await this.tableExists())) {
          throw new Error("COMPONENT_TABLE_NOT_FOUND");
        }
        const client = getClient();
        const results = await client
          .insert(gbhetPensionEmployerPlans)
          .values(record)
          .onConflictDoUpdate({
            target: [gbhetPensionEmployerPlans.employerId],
            set: {
              plan: record.plan,
              data: record.data,
            },
          })
          .returning();
        return results[0];
      },

      async delete(id: string): Promise<boolean> {
        if (!(await this.tableExists())) {
          throw new Error("COMPONENT_TABLE_NOT_FOUND");
        }
        const client = getClient();
        const results = await client
          .delete(gbhetPensionEmployerPlans)
          .where(eq(gbhetPensionEmployerPlans.id, id))
          .returning({ id: gbhetPensionEmployerPlans.id });
        return results.length > 0;
      },
    },

    aiFactors: {
      async tableExists(): Promise<boolean> {
        return tableExistsUtil(aiFactorsTableName);
      },

      async getAll(): Promise<GbhetPensionAiFactor[]> {
        if (!(await this.tableExists())) throw new Error("COMPONENT_TABLE_NOT_FOUND");
        const client = getClient();
        return client.select().from(gbhetPensionAiFactors).orderBy(gbhetPensionAiFactors.age);
      },

      async get(id: string): Promise<GbhetPensionAiFactor | undefined> {
        if (!(await this.tableExists())) throw new Error("COMPONENT_TABLE_NOT_FOUND");
        const client = getClient();
        const results = await client.select().from(gbhetPensionAiFactors).where(eq(gbhetPensionAiFactors.id, id));
        return results[0];
      },

      async getByAge(age: number): Promise<GbhetPensionAiFactor | undefined> {
        if (!(await this.tableExists())) throw new Error("COMPONENT_TABLE_NOT_FOUND");
        const client = getClient();
        const results = await client.select().from(gbhetPensionAiFactors).where(eq(gbhetPensionAiFactors.age, age));
        return results[0];
      },

      async upsert(record: InsertGbhetPensionAiFactor): Promise<GbhetPensionAiFactor> {
        if (!(await this.tableExists())) throw new Error("COMPONENT_TABLE_NOT_FOUND");
        const client = getClient();
        const results = await client
          .insert(gbhetPensionAiFactors)
          .values(record)
          .onConflictDoUpdate({
            target: [gbhetPensionAiFactors.age],
            set: { factor: record.factor, data: record.data },
          })
          .returning();
        return results[0];
      },

      async delete(id: string): Promise<boolean> {
        if (!(await this.tableExists())) throw new Error("COMPONENT_TABLE_NOT_FOUND");
        const client = getClient();
        const results = await client.delete(gbhetPensionAiFactors).where(eq(gbhetPensionAiFactors.id, id)).returning({ id: gbhetPensionAiFactors.id });
        return results.length > 0;
      },

      async deleteAll(): Promise<number> {
        if (!(await this.tableExists())) throw new Error("COMPONENT_TABLE_NOT_FOUND");
        const client = getClient();
        const results = await client.delete(gbhetPensionAiFactors).returning({ id: gbhetPensionAiFactors.id });
        return results.length;
      },
    },

    payoutFactors: {
      async tableExists(): Promise<boolean> {
        return tableExistsUtil(payoutFactorsTableName);
      },

      async getAll(): Promise<GbhetPensionPayoutFactor[]> {
        if (!(await this.tableExists())) throw new Error("COMPONENT_TABLE_NOT_FOUND");
        const client = getClient();
        return client.select().from(gbhetPensionPayoutFactors).orderBy(gbhetPensionPayoutFactors.electionType, gbhetPensionPayoutFactors.factorYear, gbhetPensionPayoutFactors.subscriberAge, gbhetPensionPayoutFactors.beneficiaryAge);
      },

      async getByElectionType(electionType: string): Promise<GbhetPensionPayoutFactor[]> {
        if (!(await this.tableExists())) throw new Error("COMPONENT_TABLE_NOT_FOUND");
        const client = getClient();
        return client.select().from(gbhetPensionPayoutFactors)
          .where(eq(gbhetPensionPayoutFactors.electionType, electionType))
          .orderBy(gbhetPensionPayoutFactors.factorYear, gbhetPensionPayoutFactors.subscriberAge, gbhetPensionPayoutFactors.beneficiaryAge);
      },

      async getByElectionTypeAndYear(electionType: string, factorYear: number): Promise<GbhetPensionPayoutFactor[]> {
        if (!(await this.tableExists())) throw new Error("COMPONENT_TABLE_NOT_FOUND");
        const client = getClient();
        return client.select().from(gbhetPensionPayoutFactors)
          .where(and(eq(gbhetPensionPayoutFactors.electionType, electionType), eq(gbhetPensionPayoutFactors.factorYear, factorYear)))
          .orderBy(gbhetPensionPayoutFactors.subscriberAge, gbhetPensionPayoutFactors.beneficiaryAge);
      },

      async lookup(electionType: string, subscriberAge: number, beneficiaryAge: number | null, factorYear: number): Promise<GbhetPensionPayoutFactor | undefined> {
        if (!(await this.tableExists())) throw new Error("COMPONENT_TABLE_NOT_FOUND");
        const client = getClient();
        const conditions = [
          eq(gbhetPensionPayoutFactors.electionType, electionType),
          eq(gbhetPensionPayoutFactors.subscriberAge, subscriberAge),
          eq(gbhetPensionPayoutFactors.factorYear, factorYear),
        ];
        if (beneficiaryAge != null) {
          conditions.push(eq(gbhetPensionPayoutFactors.beneficiaryAge, beneficiaryAge));
        }
        const results = await client.select().from(gbhetPensionPayoutFactors)
          .where(and(...conditions));
        return results[0];
      },

      async upsert(record: InsertGbhetPensionPayoutFactor): Promise<GbhetPensionPayoutFactor> {
        if (!(await this.tableExists())) throw new Error("COMPONENT_TABLE_NOT_FOUND");
        const client = getClient();
        const results = await client
          .insert(gbhetPensionPayoutFactors)
          .values(record)
          .onConflictDoUpdate({
            target: [gbhetPensionPayoutFactors.electionType, gbhetPensionPayoutFactors.subscriberAge, gbhetPensionPayoutFactors.beneficiaryAge, gbhetPensionPayoutFactors.factorYear],
            set: { factor: record.factor, data: record.data },
          })
          .returning();
        return results[0];
      },

      async delete(id: string): Promise<boolean> {
        if (!(await this.tableExists())) throw new Error("COMPONENT_TABLE_NOT_FOUND");
        const client = getClient();
        const results = await client.delete(gbhetPensionPayoutFactors).where(eq(gbhetPensionPayoutFactors.id, id)).returning({ id: gbhetPensionPayoutFactors.id });
        return results.length > 0;
      },

      async deleteByElectionType(electionType: string): Promise<number> {
        if (!(await this.tableExists())) throw new Error("COMPONENT_TABLE_NOT_FOUND");
        const client = getClient();
        const results = await client.delete(gbhetPensionPayoutFactors)
          .where(eq(gbhetPensionPayoutFactors.electionType, electionType))
          .returning({ id: gbhetPensionPayoutFactors.id });
        return results.length;
      },

      async deleteByElectionTypeAndYear(electionType: string, factorYear: number): Promise<number> {
        if (!(await this.tableExists())) throw new Error("COMPONENT_TABLE_NOT_FOUND");
        const client = getClient();
        const results = await client.delete(gbhetPensionPayoutFactors)
          .where(and(eq(gbhetPensionPayoutFactors.electionType, electionType), eq(gbhetPensionPayoutFactors.factorYear, factorYear)))
          .returning({ id: gbhetPensionPayoutFactors.id });
        return results.length;
      },

      async deleteAll(): Promise<number> {
        if (!(await this.tableExists())) throw new Error("COMPONENT_TABLE_NOT_FOUND");
        const client = getClient();
        const results = await client.delete(gbhetPensionPayoutFactors).returning({ id: gbhetPensionPayoutFactors.id });
        return results.length;
      },
    },

    earlyRetirementFactors: {
      async tableExists(): Promise<boolean> {
        return tableExistsUtil(earlyRetirementFactorsTableName);
      },

      async getAll(): Promise<GbhetPensionEarlyRetirementFactor[]> {
        if (!(await this.tableExists())) throw new Error("COMPONENT_TABLE_NOT_FOUND");
        const client = getClient();
        return client.select().from(gbhetPensionEarlyRetirementFactors).orderBy(gbhetPensionEarlyRetirementFactors.reason);
      },

      async getByReason(reason: string): Promise<GbhetPensionEarlyRetirementFactor | undefined> {
        if (!(await this.tableExists())) throw new Error("COMPONENT_TABLE_NOT_FOUND");
        const client = getClient();
        const results = await client.select().from(gbhetPensionEarlyRetirementFactors)
          .where(eq(gbhetPensionEarlyRetirementFactors.reason, reason));
        return results[0];
      },

      async upsert(record: InsertGbhetPensionEarlyRetirementFactor): Promise<GbhetPensionEarlyRetirementFactor> {
        if (!(await this.tableExists())) throw new Error("COMPONENT_TABLE_NOT_FOUND");
        const client = getClient();
        const results = await client
          .insert(gbhetPensionEarlyRetirementFactors)
          .values(record)
          .onConflictDoUpdate({
            target: [gbhetPensionEarlyRetirementFactors.reason],
            set: { monthlyFactor: record.monthlyFactor, data: record.data },
          })
          .returning();
        return results[0];
      },

      async delete(id: string): Promise<boolean> {
        if (!(await this.tableExists())) throw new Error("COMPONENT_TABLE_NOT_FOUND");
        const client = getClient();
        const results = await client.delete(gbhetPensionEarlyRetirementFactors).where(eq(gbhetPensionEarlyRetirementFactors.id, id)).returning({ id: gbhetPensionEarlyRetirementFactors.id });
        return results.length > 0;
      },

      async deleteAll(): Promise<number> {
        if (!(await this.tableExists())) throw new Error("COMPONENT_TABLE_NOT_FOUND");
        const client = getClient();
        const results = await client.delete(gbhetPensionEarlyRetirementFactors).returning({ id: gbhetPensionEarlyRetirementFactors.id });
        return results.length;
      },
    },

    interestRates: {
      async tableExists(): Promise<boolean> {
        return tableExistsUtil(interestRatesTableName);
      },

      async getAll(): Promise<GbhetPensionInterestRate[]> {
        if (!(await this.tableExists())) throw new Error("COMPONENT_TABLE_NOT_FOUND");
        const client = getClient();
        return client.select().from(gbhetPensionInterestRates).orderBy(gbhetPensionInterestRates.year);
      },

      async getByYear(year: number): Promise<GbhetPensionInterestRate | undefined> {
        if (!(await this.tableExists())) throw new Error("COMPONENT_TABLE_NOT_FOUND");
        const client = getClient();
        const results = await client.select().from(gbhetPensionInterestRates)
          .where(eq(gbhetPensionInterestRates.year, year));
        return results[0];
      },

      async upsert(record: InsertGbhetPensionInterestRate): Promise<GbhetPensionInterestRate> {
        if (!(await this.tableExists())) throw new Error("COMPONENT_TABLE_NOT_FOUND");
        const client = getClient();
        const results = await client
          .insert(gbhetPensionInterestRates)
          .values(record)
          .onConflictDoUpdate({
            target: [gbhetPensionInterestRates.year],
            set: { rate: record.rate, data: record.data },
          })
          .returning();
        return results[0];
      },

      async delete(id: string): Promise<boolean> {
        if (!(await this.tableExists())) throw new Error("COMPONENT_TABLE_NOT_FOUND");
        const client = getClient();
        const results = await client.delete(gbhetPensionInterestRates).where(eq(gbhetPensionInterestRates.id, id)).returning({ id: gbhetPensionInterestRates.id });
        return results.length > 0;
      },

      async deleteAll(): Promise<number> {
        if (!(await this.tableExists())) throw new Error("COMPONENT_TABLE_NOT_FOUND");
        const client = getClient();
        const results = await client.delete(gbhetPensionInterestRates).returning({ id: gbhetPensionInterestRates.id });
        return results.length;
      },
    },
  };
}
