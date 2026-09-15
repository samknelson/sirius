import { createNoopValidator } from '../utils/validation';
import { getClient, runInTransaction } from '../transaction-context';
import { trustBenefits, trustWmb, optionsTrustBenefitType, type TrustBenefit, type InsertTrustBenefit } from "@shared/schema";
import { eq, asc, sql } from "drizzle-orm";
import { defineLoggingConfig, type StorageLoggingConfig } from "../middleware/logging";
import {
  affectedWorkerBenefitRoleHistoryWorkers,
  enqueueWorkerBenefitRoleHistoryInvalidations,
} from "./worker-benefit-role-history-invalidation";

/**
 * Stub validator - add validation logic here when needed
 */
export const validate = createNoopValidator();

export interface TrustBenefitStorage {
  getAllTrustBenefits(): Promise<any[]>;
  getActiveTrustBenefitOptions(): Promise<{ id: string; name: string }[]>;
  getTrustBenefit(id: string): Promise<any | undefined>;
  createTrustBenefit(benefit: InsertTrustBenefit): Promise<TrustBenefit>;
  updateTrustBenefit(id: string, benefit: Partial<InsertTrustBenefit>): Promise<TrustBenefit | undefined>;
  deleteTrustBenefit(id: string): Promise<boolean>;
}

export function createTrustBenefitStorage(): TrustBenefitStorage {
  return {
    async getAllTrustBenefits(): Promise<any[]> {
      const client = getClient();
      const results = await client
        .select({
          id: trustBenefits.id,
          siriusId: trustBenefits.siriusId,
          name: trustBenefits.name,
          benefitType: trustBenefits.benefitType,
          benefitTypeName: optionsTrustBenefitType.name,
          benefitTypeSequence: optionsTrustBenefitType.sequence,
          benefitTypeData: optionsTrustBenefitType.data,
          color: trustBenefits.color,
          showOnWorkerList: trustBenefits.showOnWorkerList,
          isActive: trustBenefits.isActive,
          description: trustBenefits.description,
          providerId: trustBenefits.providerId,
        })
        .from(trustBenefits)
        .leftJoin(optionsTrustBenefitType, eq(trustBenefits.benefitType, optionsTrustBenefitType.id));
      
      return results.map(r => ({
        ...r,
        benefitTypeIcon: (r.benefitTypeData as any)?.icon || null,
        benefitTypeShowOnEnrollmentWizards: (r.benefitTypeData as any)?.showOnEnrollmentWizards,
        benefitTypeOnlyOne: (r.benefitTypeData as any)?.onlyOne === true,
        benefitTypeData: undefined,
      }));
    },

    async getActiveTrustBenefitOptions(): Promise<{ id: string; name: string }[]> {
      const client = getClient();
      const results = await client
        .select({ id: trustBenefits.id, name: trustBenefits.name })
        .from(trustBenefits)
        .where(eq(trustBenefits.isActive, true))
        .orderBy(asc(trustBenefits.name));
      return results;
    },

    async getTrustBenefit(id: string): Promise<any | undefined> {
      const client = getClient();
      const [result] = await client
        .select({
          id: trustBenefits.id,
          siriusId: trustBenefits.siriusId,
          name: trustBenefits.name,
          benefitType: trustBenefits.benefitType,
          benefitTypeName: optionsTrustBenefitType.name,
          benefitTypeData: optionsTrustBenefitType.data,
          color: trustBenefits.color,
          showOnWorkerList: trustBenefits.showOnWorkerList,
          isActive: trustBenefits.isActive,
          description: trustBenefits.description,
          providerId: trustBenefits.providerId,
        })
        .from(trustBenefits)
        .leftJoin(optionsTrustBenefitType, eq(trustBenefits.benefitType, optionsTrustBenefitType.id))
        .where(eq(trustBenefits.id, id));
      
      if (!result) return undefined;
      
      return {
        ...result,
        benefitTypeIcon: (result.benefitTypeData as any)?.icon || null,
        benefitTypeData: undefined,
      };
    },

    async createTrustBenefit(benefit: InsertTrustBenefit): Promise<TrustBenefit> {
      validate.validateOrThrow(benefit);
      const client = getClient();
      try {
        const [newBenefit] = await client
          .insert(trustBenefits)
          .values(benefit)
          .returning();
        return newBenefit;
      } catch (error: any) {
        if (error.code === '23505') {
          throw new Error("A trust benefit with this ID already exists");
        }
        throw error;
      }
    },

    async updateTrustBenefit(id: string, benefit: Partial<InsertTrustBenefit>): Promise<TrustBenefit | undefined> {
      validate.validateOrThrow(id);
      const client = getClient();
      try {
        const [updatedBenefit] = await client
          .update(trustBenefits)
          .set(benefit)
          .where(eq(trustBenefits.id, id))
          .returning();
        return updatedBenefit || undefined;
      } catch (error: any) {
        if (error.code === '23505') {
          throw new Error("A trust benefit with this ID already exists");
        }
        throw error;
      }
    },

    async deleteTrustBenefit(id: string): Promise<boolean> {
      return runInTransaction(async () => {
        const client = getClient();
        // FK inserts acquire KEY SHARE on the parent. Lock it before taking the
        // cascading-WMB snapshot so an insert cannot commit between snapshot
        // and delete and escape the role-history invalidation.
        await client.execute(sql`
          SELECT id FROM trust_benefits WHERE id = ${id} FOR UPDATE
        `);
        // The benefit FK cascades its WMB rows directly in PostgreSQL. Capture
        // both receivers and relationship grantors before that cascade.
        const wmbSources = await client
          .select({ workerId: trustWmb.workerId, sourceRelationId: trustWmb.sourceRelationId })
          .from(trustWmb)
          .where(eq(trustWmb.benefitId, id));
        const affectedWorkers = await affectedWorkerBenefitRoleHistoryWorkers(wmbSources);
        const result = await client.delete(trustBenefits).where(eq(trustBenefits.id, id)).returning();
        if (result.length > 0) {
          await enqueueWorkerBenefitRoleHistoryInvalidations(affectedWorkers);
        }
        return result.length > 0;
      });
    }
  };
}

export const trustBenefitLoggingConfig = defineLoggingConfig<TrustBenefitStorage>({
  module: 'trustBenefits',
  table: 'trust_benefits',
  getter: 'getTrustBenefit',
  methods: {
    createTrustBenefit: {
      getEntityId: (args) => args[0]?.name || 'new trust benefit',
      metadataEntityId: (_args, result) => result?.id,
    },
    updateTrustBenefit: {},
    deleteTrustBenefit: {},
  },
});
