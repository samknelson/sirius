import { db } from "../db";
import { employers, type Employer, type InsertEmployer } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { type StorageLoggingConfig } from "./middleware/logging";

export interface EmployerWorker {
  workerId: string;
  workerSiriusId: number | null;
  contactName: string | null;
  employmentHistoryId: string | null;
  employmentStatusId: string | null;
  employmentStatusName: string | null;
  position: string | null;
  date: string | null;
  home: boolean | null;
}

export interface EmployerStorage {
  getAllEmployers(): Promise<Employer[]>;
  getEmployer(id: string): Promise<Employer | undefined>;
  getEmployerWorkers(employerId: string): Promise<EmployerWorker[]>;
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

    async getEmployerWorkers(employerId: string): Promise<EmployerWorker[]> {
      const result = await db.execute(sql`
        SELECT DISTINCT ON (w.id)
          w.id as "workerId",
          w.sirius_id as "workerSiriusId",
          c.display_name as "contactName",
          wh.id as "employmentHistoryId",
          NULL as "employmentStatusId",
          NULL as "employmentStatusName",
          NULL as position,
          NULL as date,
          wh.home
        FROM workers w
        INNER JOIN worker_hours wh ON w.id = wh.worker_id
        INNER JOIN contacts c ON w.contact_id = c.id
        WHERE wh.employer_id = ${employerId}
        ORDER BY w.id, c.family, c.given
      `);
      
      return result.rows as unknown as EmployerWorker[];
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

export const employerLoggingConfig: StorageLoggingConfig<EmployerStorage> = {
  module: 'employers',
  methods: {
    createEmployer: {
      enabled: true,
      getEntityId: (args, result) => result?.id || args[0]?.name || 'new employer',
      getHostEntityId: (args, result) => result?.id,
      after: async (args, result, storage) => {
        return result;
      }
    },
    updateEmployer: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: (args) => args[0],
      before: async (args, storage) => {
        return await storage.getEmployer(args[0]);
      },
      after: async (args, result, storage) => {
        return result;
      }
    },
    deleteEmployer: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: (args, result, beforeState) => beforeState?.id || args[0],
      before: async (args, storage) => {
        return await storage.getEmployer(args[0]);
      }
    }
  }
};
