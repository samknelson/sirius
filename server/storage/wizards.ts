import { createNoopValidator } from './utils/validation';
import { getClient } from './transaction-context';
import { wizards, wizardReportData, wizardEmployerMonthly, type Wizard, type InsertWizard, type WizardReportData, type InsertWizardReportData } from "@shared/schema";
import { eq, and, desc, or, lt } from "drizzle-orm";
import { type StorageLoggingConfig } from "./middleware/logging";
import { wizardRegistry } from "../wizards";
import { db } from './db';
import { runInTransaction } from './transaction-context';

/**
 * Stub validator - add validation logic here when needed
 */
export const validate = createNoopValidator<InsertWizard, Wizard>();

export interface MonthlyWizardCreateParams {
  wizard: InsertWizard;
  employerId: string;
  year: number;
  month: number;
}

export interface MonthlyWizardCreateResult {
  success: boolean;
  wizard?: Wizard;
  error?: string;
}

export interface WizardStorage {
  list(filters?: { type?: string; status?: string; entityId?: string }): Promise<Wizard[]>;
  listAll(): Promise<Pick<Wizard, 'id' | 'type' | 'data'>[]>;
  getById(id: string): Promise<Wizard | undefined>;
  create(wizard: InsertWizard): Promise<Wizard>;
  createMonthlyWizard(params: MonthlyWizardCreateParams): Promise<MonthlyWizardCreateResult>;
  createCorrectionsWizard(params: MonthlyWizardCreateParams): Promise<MonthlyWizardCreateResult>;
  update(id: string, updates: Partial<Omit<InsertWizard, 'id'>>): Promise<Wizard | undefined>;
  delete(id: string): Promise<boolean>;
  saveReportData(wizardId: string, pk: string, data: any): Promise<WizardReportData>;
  getReportData(wizardId: string): Promise<WizardReportData[]>;
  getLatestReportData(wizardId: string): Promise<WizardReportData | undefined>;
  deleteReportData(wizardId: string): Promise<number>;
  countExpiredReportData(wizardId: string, cutoffDate: Date): Promise<number>;
  deleteExpiredReportData(wizardId: string, cutoffDate: Date): Promise<number>;
}

export function createWizardStorage(): WizardStorage {
  return {
    async list(filters?: { type?: string; status?: string; entityId?: string }): Promise<Wizard[]> {
      const client = getClient();
      const conditions = [];
      
      if (filters?.type) {
        conditions.push(eq(wizards.type, filters.type));
      }
      if (filters?.status) {
        conditions.push(eq(wizards.status, filters.status));
      }
      if (filters?.entityId) {
        conditions.push(eq(wizards.entityId, filters.entityId));
      }

      if (conditions.length > 0) {
        return client
          .select()
          .from(wizards)
          .where(and(...conditions))
          .orderBy(desc(wizards.date));
      } else {
        return client
          .select()
          .from(wizards)
          .orderBy(desc(wizards.date));
      }
    },

    async listAll(): Promise<Pick<Wizard, 'id' | 'type' | 'data'>[]> {
      const client = getClient();
      return client
        .select({
          id: wizards.id,
          type: wizards.type,
          data: wizards.data,
        })
        .from(wizards);
    },

    async getById(id: string): Promise<Wizard | undefined> {
      const client = getClient();
      const [wizard] = await client.select().from(wizards).where(eq(wizards.id, id));
      return wizard || undefined;
    },

    async create(insertWizard: InsertWizard): Promise<Wizard> {
      const client = getClient();
      const [wizard] = await client
        .insert(wizards)
        .values(insertWizard)
        .returning();
      return wizard;
    },

    async createMonthlyWizard(params: MonthlyWizardCreateParams): Promise<MonthlyWizardCreateResult> {
      const { wizard: wizardData, employerId, year, month } = params;
      
      try {
        const createdWizard = await db.transaction(async (tx) => {
          const existingWizards = await tx
            .select()
            .from(wizardEmployerMonthly)
            .innerJoin(wizards, eq(wizardEmployerMonthly.wizardId, wizards.id))
            .where(
              and(
                eq(wizardEmployerMonthly.employerId, employerId),
                eq(wizardEmployerMonthly.year, year),
                eq(wizardEmployerMonthly.month, month),
                eq(wizards.type, 'gbhet_legal_workers_monthly')
              )
            );
          
          if (existingWizards.length > 0) {
            throw new Error(`DUPLICATE: A legal workers monthly wizard already exists for this employer in ${month}/${year}`);
          }
          
          const [wizard] = await tx
            .insert(wizards)
            .values(wizardData)
            .returning();
          
          await tx.insert(wizardEmployerMonthly).values({
            wizardId: wizard.id,
            employerId,
            year,
            month,
          });
          
          return wizard;
        });
        
        return { success: true, wizard: createdWizard };
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('DUPLICATE:')) {
          return { success: false, error: error.message.replace('DUPLICATE: ', '') };
        }
        throw error;
      }
    },

    async createCorrectionsWizard(params: MonthlyWizardCreateParams): Promise<MonthlyWizardCreateResult> {
      const { wizard: wizardData, employerId, year, month } = params;
      
      try {
        const createdWizard = await db.transaction(async (tx) => {
          const [completedMonthly] = await tx
            .select()
            .from(wizardEmployerMonthly)
            .innerJoin(wizards, eq(wizardEmployerMonthly.wizardId, wizards.id))
            .where(
              and(
                eq(wizardEmployerMonthly.employerId, employerId),
                eq(wizardEmployerMonthly.year, year),
                eq(wizardEmployerMonthly.month, month),
                eq(wizards.type, 'gbhet_legal_workers_monthly'),
                or(eq(wizards.status, 'completed'), eq(wizards.status, 'complete'))
              )
            );
          
          if (!completedMonthly) {
            throw new Error(`PREREQUISITE: Cannot create legal workers corrections wizard: no completed legal workers monthly wizard found for ${month}/${year}`);
          }
          
          const [wizard] = await tx
            .insert(wizards)
            .values(wizardData)
            .returning();
          
          await tx.insert(wizardEmployerMonthly).values({
            wizardId: wizard.id,
            employerId,
            year,
            month,
          });
          
          return wizard;
        });
        
        return { success: true, wizard: createdWizard };
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('PREREQUISITE:')) {
          return { success: false, error: error.message.replace('PREREQUISITE: ', '') };
        }
        throw error;
      }
    },

    async update(id: string, updates: Partial<Omit<InsertWizard, 'id'>>): Promise<Wizard | undefined> {
      const client = getClient();
      const [wizard] = await client
        .update(wizards)
        .set(updates)
        .where(eq(wizards.id, id))
        .returning();
      return wizard || undefined;
    },

    async delete(id: string): Promise<boolean> {
      const client = getClient();
      const result = await client.delete(wizards).where(eq(wizards.id, id)).returning();
      return result.length > 0;
    },

    async saveReportData(wizardId: string, pk: string, data: any): Promise<WizardReportData> {
      const client = getClient();
      const [reportData] = await client
        .insert(wizardReportData)
        .values({
          wizardId,
          pk,
          data
        })
        .onConflictDoUpdate({
          target: [wizardReportData.wizardId, wizardReportData.pk],
          set: { data, createdAt: new Date() }
        })
        .returning();
      return reportData;
    },

    async getReportData(wizardId: string): Promise<WizardReportData[]> {
      const client = getClient();
      return client
        .select()
        .from(wizardReportData)
        .where(eq(wizardReportData.wizardId, wizardId))
        .orderBy(desc(wizardReportData.createdAt));
    },

    async getLatestReportData(wizardId: string): Promise<WizardReportData | undefined> {
      const client = getClient();
      const [reportData] = await client
        .select()
        .from(wizardReportData)
        .where(eq(wizardReportData.wizardId, wizardId))
        .orderBy(desc(wizardReportData.createdAt))
        .limit(1);
      return reportData || undefined;
    },

    async deleteReportData(wizardId: string): Promise<number> {
      const client = getClient();
      const result = await client
        .delete(wizardReportData)
        .where(eq(wizardReportData.wizardId, wizardId))
        .returning();
      return result.length;
    },

    async countExpiredReportData(wizardId: string, cutoffDate: Date): Promise<number> {
      const client = getClient();
      const result = await client
        .select()
        .from(wizardReportData)
        .where(
          and(
            eq(wizardReportData.wizardId, wizardId),
            lt(wizardReportData.createdAt, cutoffDate)
          )
        );
      return result.length;
    },

    async deleteExpiredReportData(wizardId: string, cutoffDate: Date): Promise<number> {
      const client = getClient();
      const result = await client
        .delete(wizardReportData)
        .where(
          and(
            eq(wizardReportData.wizardId, wizardId),
            lt(wizardReportData.createdAt, cutoffDate)
          )
        )
        .returning();
      return result.length;
    }
  };
}

export const wizardLoggingConfig: StorageLoggingConfig<WizardStorage> = {
  module: 'wizards',
  methods: {
    create: {
      enabled: true,
      getEntityId: (args) => args[0]?.type || 'new wizard',
      getHostEntityId: (args, result) => {
        return result?.entityId || null;
      },
      getDescription: async (args, result) => {
        const wizard = result;
        const wizardType = wizardRegistry.get(wizard?.type);
        const displayName = wizardType?.displayName || wizard?.type || 'Unknown wizard';
        const date = wizard?.date ? new Date(wizard.date).toISOString() : 'unknown date';
        return `${displayName}, ${date}`;
      },
      after: async (args, result, storage) => {
        return result;
      }
    },
    update: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: (args, result, beforeState) => {
        return result?.entityId ?? beforeState?.entityId ?? null;
      },
      getDescription: async (args, result, beforeState) => {
        const wizard = result ?? beforeState;
        const wizardType = wizardRegistry.get(wizard?.type);
        const displayName = wizardType?.displayName || wizard?.type || 'Unknown wizard';
        const date = wizard?.date ? new Date(wizard.date).toISOString() : 'unknown date';
        return `${displayName}, ${date}`;
      },
      before: async (args, storage) => {
        return await storage.getById(args[0]);
      },
      after: async (args, result, storage) => {
        return result;
      }
    },
    delete: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: (args, result, beforeState) => {
        return beforeState?.entityId ?? null;
      },
      getDescription: async (args, result, beforeState) => {
        const wizard = beforeState;
        const wizardType = wizardRegistry.get(wizard?.type);
        const displayName = wizardType?.displayName || wizard?.type || 'Unknown wizard';
        const date = wizard?.date ? new Date(wizard.date).toISOString() : 'unknown date';
        return `${displayName}, ${date}`;
      },
      before: async (args, storage) => {
        return await storage.getById(args[0]);
      }
    }
  }
};
