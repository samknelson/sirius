import { createNoopValidator } from './utils/validation';
import { getClient } from './transaction-context';
import { employers, type Employer, type InsertEmployer } from "@shared/schema";
import { eq, sql, inArray } from "drizzle-orm";
import { type StorageLoggingConfig } from "./middleware/logging";

/**
 * Stub validator - add validation logic here when needed
 */
export const validate = createNoopValidator<InsertEmployer, Employer>();

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
  getByIds(ids: string[]): Promise<Employer[]>;
  getEmployerWorkers(employerId: string): Promise<EmployerWorker[]>;
  createEmployer(employer: InsertEmployer): Promise<Employer>;
  updateEmployer(id: string, employer: Partial<InsertEmployer>): Promise<Employer | undefined>;
  updateEmployerPolicy(employerId: string, denormPolicyId: string | null): Promise<Employer | undefined>;
  deleteEmployer(id: string): Promise<boolean>;
}

export function createEmployerStorage(): EmployerStorage {
  return {
    async getAllEmployers(): Promise<Employer[]> {
      const client = getClient();
      return await client.select().from(employers);
    },

    async getEmployer(id: string): Promise<Employer | undefined> {
      const client = getClient();
      const [employer] = await client.select().from(employers).where(eq(employers.id, id));
      return employer || undefined;
    },

    async getByIds(ids: string[]): Promise<Employer[]> {
      if (ids.length === 0) return [];
      const client = getClient();
      return await client.select().from(employers).where(inArray(employers.id, ids));
    },

    async getEmployerWorkers(employerId: string): Promise<EmployerWorker[]> {
      const client = getClient();
      const result = await client.execute(sql`
        SELECT DISTINCT ON (w.id)
          w.id as "workerId",
          w.sirius_id as "workerSiriusId",
          c.display_name as "contactName",
          wh.id as "employmentHistoryId",
          wh.employment_status_id as "employmentStatusId",
          es.name as "employmentStatusName",
          NULL as position,
          make_date(wh.year, wh.month, wh.day)::text as date,
          wh.home
        FROM workers w
        INNER JOIN worker_hours wh ON w.id = wh.worker_id
        INNER JOIN contacts c ON w.contact_id = c.id
        LEFT JOIN options_employment_status es ON wh.employment_status_id = es.id
        WHERE wh.employer_id = ${employerId}
        ORDER BY w.id, wh.year DESC, wh.month DESC, wh.day DESC
      `);
      
      return result.rows as unknown as EmployerWorker[];
    },

    async createEmployer(employer: InsertEmployer): Promise<Employer> {
      const client = getClient();
      try {
        const [newEmployer] = await client
          .insert(employers)
          .values(employer)
          .returning();
        return newEmployer;
      } catch (error: any) {
        if (error.code === '23505') {
          throw new Error("An employer with this ID already exists");
        }
        throw error;
      }
    },

    async updateEmployer(id: string, employer: Partial<InsertEmployer>): Promise<Employer | undefined> {
      const client = getClient();
      try {
        const [updatedEmployer] = await client
          .update(employers)
          .set(employer)
          .where(eq(employers.id, id))
          .returning();
        return updatedEmployer || undefined;
      } catch (error: any) {
        if (error.code === '23505') {
          throw new Error("An employer with this ID already exists");
        }
        throw error;
      }
    },

    async updateEmployerPolicy(employerId: string, denormPolicyId: string | null): Promise<Employer | undefined> {
      const client = getClient();
      const [updatedEmployer] = await client
        .update(employers)
        .set({ denormPolicyId })
        .where(eq(employers.id, employerId))
        .returning();
      
      return updatedEmployer || undefined;
    },

    async deleteEmployer(id: string): Promise<boolean> {
      const client = getClient();
      const result = await client.delete(employers).where(eq(employers.id, id)).returning();
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
