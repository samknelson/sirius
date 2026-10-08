import { createNoopValidator } from './utils/validation';
import { getClient } from './transaction-context';
import { wizardEmployerMonthly, wizards, employers, insertWizardEmployerMonthlySchema } from "@shared/schema";
import { eq, and, or } from "drizzle-orm";
import { z } from "zod";
import { compliancePeriods } from "@shared/employer-compliance";

/**
 * Stub validator - add validation logic here when needed
 */
export const validate = createNoopValidator();

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
  listByEmployer(employerId: string, year?: number, month?: number): Promise<WizardEmployerMonthly[]>;
  listAllEmployersWithUploadsForRange(year: number, month: number, wizardType: string, monthsBack?: number): Promise<EmployerWithUploads[]>;
  listEmployerWithUploadsForRange(employerId: string, year: number, month: number, wizardType: string, monthsBack?: number): Promise<EmployerWithUploads | undefined>;
  findWizards(employerId: string, wizardType: string, year: number, month: number, status?: string | string[]): Promise<any[]>;
  delete(wizardId: string): Promise<boolean>;
}

/** One query shape for the dashboard and the employer-scoped token lookup. */
async function listEmployersWithUploadsForRange(
  year: number, month: number, wizardType: string, monthsBack: number, employerId?: string,
): Promise<EmployerWithUploads[]> {
  const client = getClient();
  const selectedEmployers = await client.select().from(employers).where(
    employerId === undefined ? undefined : eq(employers.id, employerId),
  );
  if (selectedEmployers.length === 0) return [];

  const periods = compliancePeriods({
    year, month, monthsBack: Math.max(1, Math.min(24, monthsBack)),
  });
  const uploads = await client
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
    .where(and(
      or(...periods.map(period => and(
        eq(wizardEmployerMonthly.year, period.year),
        eq(wizardEmployerMonthly.month, period.month),
      ))),
      eq(wizards.type, wizardType),
      employerId === undefined ? undefined : eq(wizardEmployerMonthly.employerId, employerId),
    ));
  return selectedEmployers.map(employer => ({
    employer,
    uploads: uploads.filter(upload => upload.employerId === employer.id),
  }));
}

export function createWizardEmployerMonthlyStorage(): WizardEmployerMonthlyStorage {
  return {
    async create(data: InsertWizardEmployerMonthly): Promise<WizardEmployerMonthly> {
      validate.validateOrThrow(data);
      const client = getClient();
      const [record] = await client
        .insert(wizardEmployerMonthly)
        .values(data)
        .returning();
      return record;
    },

    async getByWizardId(wizardId: string): Promise<WizardEmployerMonthly | undefined> {
      const client = getClient();
      const [record] = await client
        .select()
        .from(wizardEmployerMonthly)
        .where(eq(wizardEmployerMonthly.wizardId, wizardId));
      return record || undefined;
    },

    async listByEmployer(
      employerId: string,
      year?: number,
      month?: number
    ): Promise<WizardEmployerMonthly[]> {
      const client = getClient();
      const conditions = [eq(wizardEmployerMonthly.employerId, employerId)];
      
      if (year !== undefined) {
        conditions.push(eq(wizardEmployerMonthly.year, year));
      }
      if (month !== undefined) {
        conditions.push(eq(wizardEmployerMonthly.month, month));
      }

      const whereClause = conditions.length > 1 ? and(...conditions) : conditions[0];

      return client
        .select()
        .from(wizardEmployerMonthly)
        .where(whereClause);
    },

    async listAllEmployersWithUploadsForRange(year: number, month: number, wizardType: string, monthsBack: number = 5): Promise<EmployerWithUploads[]> {
      return listEmployersWithUploadsForRange(year, month, wizardType, monthsBack);
    },

    async listEmployerWithUploadsForRange(employerId: string, year: number, month: number, wizardType: string, monthsBack: number = 5): Promise<EmployerWithUploads | undefined> {
      const rows = await listEmployersWithUploadsForRange(year, month, wizardType, monthsBack, employerId);
      return rows[0];
    },

    async findWizards(
      employerId: string,
      wizardType: string,
      year: number,
      month: number,
      status?: string | string[]
    ): Promise<any[]> {
      const client = getClient();
      const conditions = [
        eq(wizardEmployerMonthly.employerId, employerId),
        eq(wizardEmployerMonthly.year, year),
        eq(wizardEmployerMonthly.month, month),
        eq(wizards.type, wizardType)
      ];
      
      if (status) {
        if (Array.isArray(status)) {
          if (status.length > 0) {
            conditions.push(or(...status.map(s => eq(wizards.status, s)))!);
          }
        } else {
          conditions.push(eq(wizards.status, status));
        }
      }
      
      const results = await client
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
        .where(and(...conditions));
      
      return results;
    },

    async delete(wizardId: string): Promise<boolean> {
      const client = getClient();
      const result = await client
        .delete(wizardEmployerMonthly)
        .where(eq(wizardEmployerMonthly.wizardId, wizardId))
        .returning();
      return result.length > 0;
    }
  };
}
