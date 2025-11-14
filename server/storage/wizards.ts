import { db } from "../db";
import { wizards, wizardReportData, type Wizard, type InsertWizard, type WizardReportData, type InsertWizardReportData } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";

export interface WizardStorage {
  list(filters?: { type?: string; status?: string; entityId?: string }): Promise<Wizard[]>;
  getById(id: string): Promise<Wizard | undefined>;
  create(wizard: InsertWizard): Promise<Wizard>;
  update(id: string, updates: Partial<Omit<InsertWizard, 'id'>>): Promise<Wizard | undefined>;
  delete(id: string): Promise<boolean>;
  saveReportData(wizardId: string, data: any): Promise<WizardReportData>;
  getReportData(wizardId: string): Promise<WizardReportData[]>;
  getLatestReportData(wizardId: string): Promise<WizardReportData | undefined>;
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

    async saveReportData(wizardId: string, data: any): Promise<WizardReportData> {
      const [reportData] = await db
        .insert(wizardReportData)
        .values({
          wizardId,
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
    }
  };
}
