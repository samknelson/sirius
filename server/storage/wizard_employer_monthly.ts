import { db } from "../db";
import { wizardEmployerMonthly, wizards, employers, insertWizardEmployerMonthlySchema } from "@shared/schema";
import { eq, and, or, inArray } from "drizzle-orm";
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

export interface EmployerMonthlyStats {
  totalActiveEmployers: number;
  byStatus: Record<string, number>;
}

export interface WizardEmployerMonthlyStorage {
  create(data: InsertWizardEmployerMonthly): Promise<WizardEmployerMonthly>;
  getByWizardId(wizardId: string): Promise<WizardEmployerMonthly | undefined>;
  listByPeriod(year: number, month: number): Promise<any[]>;
  listByEmployer(employerId: string, year?: number, month?: number): Promise<WizardEmployerMonthly[]>;
  listAllEmployersWithUploads(year: number, month: number, wizardType: string): Promise<EmployerWithUploads[]>;
  listAllEmployersWithUploadsForRange(year: number, month: number, wizardType: string): Promise<EmployerWithUploads[]>;
  getMonthlyStats(year: number, month: number, wizardType: string): Promise<EmployerMonthlyStats>;
  findByEmployerTypeAndPeriod(employerId: string, wizardType: string, year: number, month: number): Promise<any[]>;
  findCompletedMonthlyByEmployerAndPeriod(employerId: string, year: number, month: number): Promise<any | undefined>;
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

    async listAllEmployersWithUploadsForRange(year: number, month: number, wizardType: string): Promise<EmployerWithUploads[]> {
      const allEmployers = await db.select().from(employers);
      
      // Calculate 5-month range: 4 months before + selected month
      const monthPeriods: Array<{ year: number; month: number }> = [];
      for (let i = 4; i >= 0; i--) {
        const targetDate = new Date(year, month - 1 - i, 1);
        monthPeriods.push({
          year: targetDate.getFullYear(),
          month: targetDate.getMonth() + 1
        });
      }
      
      // Build OR conditions for each month period
      const periodConditions = monthPeriods.map(period => 
        and(
          eq(wizardEmployerMonthly.year, period.year),
          eq(wizardEmployerMonthly.month, period.month)
        )
      );
      
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
            or(...periodConditions),
            eq(wizards.type, wizardType)
          )
        );
      
      return allEmployers.map(employer => ({
        employer,
        uploads: uploadsForPeriod.filter(upload => upload.employerId === employer.id)
      }));
    },

    async getMonthlyStats(year: number, month: number, wizardType: string): Promise<EmployerMonthlyStats> {
      const allActiveEmployers = await db
        .select()
        .from(employers)
        .where(eq(employers.isActive, true));
      
      const totalActiveEmployers = allActiveEmployers.length;
      
      const uploadsForPeriod = await db
        .select({
          employerId: wizardEmployerMonthly.employerId,
          status: wizards.status,
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
      
      const byStatus: Record<string, number> = {
        draft: 0,
        in_progress: 0,
        completed: 0,
        cancelled: 0,
        error: 0,
      };
      
      const employersWithUploads = new Set<string>();
      
      for (const upload of uploadsForPeriod) {
        employersWithUploads.add(upload.employerId);
        if (byStatus[upload.status] !== undefined) {
          byStatus[upload.status]++;
        }
      }
      
      byStatus['no_upload'] = totalActiveEmployers - employersWithUploads.size;
      
      return {
        totalActiveEmployers,
        byStatus,
      };
    },

    async findByEmployerTypeAndPeriod(
      employerId: string,
      wizardType: string,
      year: number,
      month: number
    ): Promise<any[]> {
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
            eq(wizardEmployerMonthly.employerId, employerId),
            eq(wizardEmployerMonthly.year, year),
            eq(wizardEmployerMonthly.month, month),
            eq(wizards.type, wizardType)
          )
        );
      
      return results;
    },

    async findCompletedMonthlyByEmployerAndPeriod(
      employerId: string,
      year: number,
      month: number
    ): Promise<any | undefined> {
      const [result] = await db
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
            eq(wizardEmployerMonthly.employerId, employerId),
            eq(wizardEmployerMonthly.year, year),
            eq(wizardEmployerMonthly.month, month),
            eq(wizards.type, 'legal_workers_monthly'),
            or(eq(wizards.status, 'completed'), eq(wizards.status, 'complete'))
          )
        );
      
      return result || undefined;
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
