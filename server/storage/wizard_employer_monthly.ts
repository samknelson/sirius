import { db } from "../db";
import { wizardEmployerMonthly, wizards, employers, insertWizardEmployerMonthlySchema } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

export type WizardEmployerMonthly = typeof wizardEmployerMonthly.$inferSelect;
export type InsertWizardEmployerMonthly = z.infer<typeof insertWizardEmployerMonthlySchema>;

export interface EmployerWithUploads {
  employer: typeof employers.$inferSelect;
  uploads: Array<{
    wizardId: string;
    employerId: string;
    year: number;
    month: number;
    id: string;
    type: string;
    status: string;
    currentStep: string | null;
    entityId: string | null;
    data: any;
    createdAt: Date | null;
  }>;
}

export interface WizardEmployerMonthlyStorage {
  create(data: InsertWizardEmployerMonthly): Promise<WizardEmployerMonthly>;
  getByWizardId(wizardId: string): Promise<WizardEmployerMonthly | undefined>;
  listByPeriod(year: number, month: number): Promise<any[]>;
  listByEmployer(employerId: string, year?: number, month?: number): Promise<WizardEmployerMonthly[]>;
  listAllEmployersWithUploads(year: number, month: number, wizardType: string): Promise<EmployerWithUploads[]>;
  delete(wizardId: string): Promise<boolean>;
}

export function createWizardEmployerMonthlyStorage(): WizardEmployerMonthlyStorage {
  return {
    async create(data: InsertWizardEmployerMonthly): Promise<WizardEmployerMonthly> {
      const [record] = await db
        .insert(wizardEmployerMonthly)
        .values(data)
        .returning();
      return record;
    },

    async getByWizardId(wizardId: string): Promise<WizardEmployerMonthly | undefined> {
      const [record] = await db
        .select()
        .from(wizardEmployerMonthly)
        .where(eq(wizardEmployerMonthly.wizardId, wizardId));
      return record || undefined;
    },

    async listByPeriod(year: number, month: number): Promise<any[]> {
      const results = await db
        .select({
          wizardId: wizardEmployerMonthly.wizardId,
          employerId: wizardEmployerMonthly.employerId,
          year: wizardEmployerMonthly.year,
          month: wizardEmployerMonthly.month,
          id: wizards.id,
          type: wizards.type,
          status: wizards.status,
          currentStep: wizards.currentStep,
          entityId: wizards.entityId,
          data: wizards.data,
          createdAt: wizards.date,
        })
        .from(wizardEmployerMonthly)
        .innerJoin(wizards, eq(wizardEmployerMonthly.wizardId, wizards.id))
        .where(
          and(
            eq(wizardEmployerMonthly.year, year),
            eq(wizardEmployerMonthly.month, month)
          )
        );
      
      return results;
    },

    async listByEmployer(
      employerId: string,
      year?: number,
      month?: number
    ): Promise<WizardEmployerMonthly[]> {
      const conditions = [eq(wizardEmployerMonthly.employerId, employerId)];
      
      if (year !== undefined) {
        conditions.push(eq(wizardEmployerMonthly.year, year));
      }
      if (month !== undefined) {
        conditions.push(eq(wizardEmployerMonthly.month, month));
      }

      // Use and() only if we have multiple conditions, otherwise use the single condition
      const whereClause = conditions.length > 1 ? and(...conditions) : conditions[0];

      return db
        .select()
        .from(wizardEmployerMonthly)
        .where(whereClause);
    },

    async listAllEmployersWithUploads(year: number, month: number, wizardType: string): Promise<EmployerWithUploads[]> {
      const allEmployers = await db.select().from(employers);
      
      const uploadsForPeriod = await db
        .select({
          wizardId: wizardEmployerMonthly.wizardId,
          employerId: wizardEmployerMonthly.employerId,
          year: wizardEmployerMonthly.year,
          month: wizardEmployerMonthly.month,
          id: wizards.id,
          type: wizards.type,
          status: wizards.status,
          currentStep: wizards.currentStep,
          entityId: wizards.entityId,
          data: wizards.data,
          createdAt: wizards.date,
        })
        .from(wizardEmployerMonthly)
        .innerJoin(wizards, eq(wizardEmployerMonthly.wizardId, wizards.id))
        .where(
          and(
            eq(wizardEmployerMonthly.year, year),
            eq(wizardEmployerMonthly.month, month),
            eq(wizards.type, wizardType)
          )
        );
      
      return allEmployers.map(employer => ({
        employer,
        uploads: uploadsForPeriod.filter(upload => upload.employerId === employer.id)
      }));
    },

    async delete(wizardId: string): Promise<boolean> {
      const result = await db
        .delete(wizardEmployerMonthly)
        .where(eq(wizardEmployerMonthly.wizardId, wizardId))
        .returning();
      return result.length > 0;
    }
  };
}
