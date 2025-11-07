import { db } from "../db";
import { employers, type Employer, type InsertEmployer } from "@shared/schema";
import { eq } from "drizzle-orm";

export interface EmployerStorage {
  getAllEmployers(): Promise<Employer[]>;
  getEmployer(id: string): Promise<Employer | undefined>;
  createEmployer(employer: InsertEmployer): Promise<Employer>;
  updateEmployer(id: string, employer: Partial<InsertEmployer>): Promise<Employer | undefined>;
  deleteEmployer(id: string): Promise<boolean>;
}

export function createEmployerStorage(): EmployerStorage {
  return {
    async getAllEmployers(): Promise<Employer[]> {
      return await db.select().from(employers);
    },

    async getEmployer(id: string): Promise<Employer | undefined> {
      const [employer] = await db.select().from(employers).where(eq(employers.id, id));
      return employer || undefined;
    },

    async createEmployer(employer: InsertEmployer): Promise<Employer> {
      try {
        const [newEmployer] = await db
          .insert(employers)
          .values(employer)
          .returning();
        return newEmployer;
      } catch (error: any) {
        // Check for unique constraint violation
        if (error.code === '23505') {
          throw new Error("An employer with this ID already exists");
        }
        throw error;
      }
    },

    async updateEmployer(id: string, employer: Partial<InsertEmployer>): Promise<Employer | undefined> {
      try {
        const [updatedEmployer] = await db
          .update(employers)
          .set(employer)
          .where(eq(employers.id, id))
          .returning();
        return updatedEmployer || undefined;
      } catch (error: any) {
        // Check for unique constraint violation
        if (error.code === '23505') {
          throw new Error("An employer with this ID already exists");
        }
        throw error;
      }
    },

    async deleteEmployer(id: string): Promise<boolean> {
      const result = await db.delete(employers).where(eq(employers.id, id)).returning();
      return result.length > 0;
    }
  };
}
