import { db } from "../db";
import { wizards, wizardReportData, wizardEmployerMonthly, type Wizard, type InsertWizard, type WizardReportData, type InsertWizardReportData } from "@shared/schema";
import { eq, and, desc, or } from "drizzle-orm";
import { type StorageLoggingConfig } from "./middleware/logging";
import { wizardRegistry } from "../wizards";

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
}

export function createWizardStorage(): WizardStorage {
  return {
    async list(filters?: { type?: string; status?: string; entityId?: string }): Promise<Wizard[]> {
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
        return db
          .select()
          .from(wizards)
          .where(and(...conditions))
          .orderBy(desc(wizards.date));
      } else {
        return db
          .select()
          .from(wizards)
          .orderBy(desc(wizards.date));
      }
    },

    async getById(id: string): Promise<Wizard | undefined> {
      const [wizard] = await db.select().from(wizards).where(eq(wizards.id, id));
      return wizard || undefined;
    },

    async create(insertWizard: InsertWizard): Promise<Wizard> {
      const [wizard] = await db
        .insert(wizards)
        .values(insertWizard)
        .returning();
      return wizard;
    },

    async createMonthlyWizard(params: MonthlyWizardCreateParams): Promise<MonthlyWizardCreateResult> {
      const { wizard: wizardData, employerId, year, month } = params;
      
      try {
        const createdWizard = await db.transaction(async (tx) => {
          // Check for duplicate monthly wizard inside transaction to prevent race conditions
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
          
          // Create the wizard
          const [wizard] = await tx
            .insert(wizards)
            .values(wizardData)
            .returning();
          
          // Create the wizard_employer_monthly record
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
          // Check for completed monthly wizard prerequisite inside transaction
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
          
          // Create the wizard
          const [wizard] = await tx
            .insert(wizards)
            .values(wizardData)
            .returning();
          
          // Create the wizard_employer_monthly record
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
      const [wizard] = await db
        .update(wizards)
        .set(updates)
        .where(eq(wizards.id, id))
        .returning();
      return wizard || undefined;
    },

    async delete(id: string): Promise<boolean> {
      const result = await db.delete(wizards).where(eq(wizards.id, id)).returning();
      return result.length > 0;
    },

    async saveReportData(wizardId: string, pk: string, data: any): Promise<WizardReportData> {
      const [reportData] = await db
        .insert(wizardReportData)
        .values({
          wizardId,
          pk,
          data
        })
        .returning();
      return reportData;
    },

    async getReportData(wizardId: string): Promise<WizardReportData[]> {
      return db
        .select()
        .from(wizardReportData)
        .where(eq(wizardReportData.wizardId, wizardId))
        .orderBy(desc(wizardReportData.createdAt));
    },

    async getLatestReportData(wizardId: string): Promise<WizardReportData | undefined> {
      const [reportData] = await db
        .select()
        .from(wizardReportData)
        .where(eq(wizardReportData.wizardId, wizardId))
        .orderBy(desc(wizardReportData.createdAt))
        .limit(1);
      return reportData || undefined;
    },

    async deleteReportData(wizardId: string): Promise<number> {
      const result = await db
        .delete(wizardReportData)
        .where(eq(wizardReportData.wizardId, wizardId))
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
