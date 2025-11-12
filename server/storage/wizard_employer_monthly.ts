import { db } from "../db";
import { wizardEmployerMonthly, insertWizardEmployerMonthlySchema } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

export type WizardEmployerMonthly = typeof wizardEmployerMonthly.$inferSelect;
export type InsertWizardEmployerMonthly = z.infer<typeof insertWizardEmployerMonthlySchema>;

export interface WizardEmployerMonthlyStorage {
  create(data: InsertWizardEmployerMonthly): Promise<WizardEmployerMonthly>;
  getByWizardId(wizardId: string): Promise<WizardEmployerMonthly | undefined>;
  listByPeriod(year: number, month: number): Promise<WizardEmployerMonthly[]>;
  listByEmployer(employerId: string, year?: number, month?: number): Promise<WizardEmployerMonthly[]>;
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

    async listByPeriod(year: number, month: number): Promise<WizardEmployerMonthly[]> {
      return db
        .select()
        .from(wizardEmployerMonthly)
        .where(
          and(
            eq(wizardEmployerMonthly.year, year),
            eq(wizardEmployerMonthly.month, month)
          )
        );
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

      return db
        .select()
        .from(wizardEmployerMonthly)
        .where(and(...conditions));
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
