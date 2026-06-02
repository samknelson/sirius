import { createNoopValidator } from '../utils/validation';
import { getClient } from '../transaction-context';
import { trustBenefits, optionsTrustBenefitType, type TrustBenefit, type InsertTrustBenefit } from "@shared/schema";
import { eq, asc } from "drizzle-orm";
import { defineLoggingConfig, type StorageLoggingConfig } from "../middleware/logging";

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
          name: trustBenefits.name,
          benefitType: trustBenefits.benefitType,
          benefitTypeName: optionsTrustBenefitType.name,
          benefitTypeData: optionsTrustBenefitType.data,
          isActive: trustBenefits.isActive,
          description: trustBenefits.description,
        })
        .from(trustBenefits)
        .leftJoin(optionsTrustBenefitType, eq(trustBenefits.benefitType, optionsTrustBenefitType.id));
      
      return results.map(r => ({
        ...r,
        benefitTypeIcon: (r.benefitTypeData as any)?.icon || null,
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
          isActive: trustBenefits.isActive,
          description: trustBenefits.description,
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
      const client = getClient();
      const result = await client.delete(trustBenefits).where(eq(trustBenefits.id, id)).returning();
      return result.length > 0;
    }
  };
}

export const trustBenefitLoggingConfig = defineLoggingConfig<TrustBenefitStorage>({
  module: 'trustBenefits',
  getter: 'getTrustBenefit',
  methods: {
    createTrustBenefit: {
      getEntityId: (args) => args[0]?.name || 'new trust benefit',
    },
    updateTrustBenefit: {},
    deleteTrustBenefit: {},
  },
});
