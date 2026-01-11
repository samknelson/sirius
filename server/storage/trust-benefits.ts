import { getClient } from './transaction-context';
import { trustBenefits, optionsTrustBenefitType, type TrustBenefit, type InsertTrustBenefit } from "@shared/schema";
import { eq } from "drizzle-orm";
import { type StorageLoggingConfig } from "./middleware/logging";

export interface TrustBenefitStorage {
  getAllTrustBenefits(): Promise<any[]>;
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

    async getTrustBenefit(id: string): Promise<any | undefined> {
      const client = getClient();
      const [result] = await client
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

export const trustBenefitLoggingConfig: StorageLoggingConfig<TrustBenefitStorage> = {
  module: 'trustBenefits',
  methods: {
    createTrustBenefit: {
      enabled: true,
      getEntityId: (args) => args[0]?.name || 'new trust benefit',
      after: async (args, result, storage) => {
        return result; // Capture created trust benefit
      }
    },
    updateTrustBenefit: {
      enabled: true,
      getEntityId: (args) => args[0], // Trust benefit ID
      before: async (args, storage) => {
        return await storage.getTrustBenefit(args[0]); // Current state
      },
      after: async (args, result, storage) => {
        return result; // New state (diff auto-calculated)
      }
    },
    deleteTrustBenefit: {
      enabled: true,
      getEntityId: (args) => args[0], // Trust benefit ID
      before: async (args, storage) => {
        return await storage.getTrustBenefit(args[0]); // Capture what's being deleted
      }
    }
  }
};
