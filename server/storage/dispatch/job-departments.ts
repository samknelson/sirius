import { getClient } from '../transaction-context';
import {
  dispatchJobDepartment,
  optionsDepartment,
  type DispatchJobDepartment,
} from "@shared/schema";
import { eq, inArray } from "drizzle-orm";

export interface DispatchJobDepartmentWithName extends DispatchJobDepartment {
  department?: {
    id: string;
    name: string;
  } | null;
}

export interface DispatchJobDepartmentStorage {
  /** The job's department row (at most one per job), with the department name. */
  getByJob(jobId: string): Promise<DispatchJobDepartmentWithName | undefined>;
  /** Batch lookup for lists: jobId -> department row with name. */
  getByJobIds(jobIds: string[]): Promise<Map<string, DispatchJobDepartmentWithName>>;
  /** Upsert the job's department (unique on job_id). */
  setForJob(jobId: string, departmentId: string): Promise<DispatchJobDepartment>;
  /** Remove the job's department. Returns true if a row was deleted. */
  clearForJob(jobId: string): Promise<boolean>;
}

function withName(row: { entry: DispatchJobDepartment; departmentName: string | null }): DispatchJobDepartmentWithName {
  return {
    ...row.entry,
    department: row.departmentName ? { id: row.entry.departmentId, name: row.departmentName } : null,
  };
}

export function createDispatchJobDepartmentStorage(): DispatchJobDepartmentStorage {
  return {
    async getByJob(jobId: string) {
      const client = getClient();
      const [row] = await client
        .select({
          entry: dispatchJobDepartment,
          departmentName: optionsDepartment.name,
        })
        .from(dispatchJobDepartment)
        .leftJoin(optionsDepartment, eq(dispatchJobDepartment.departmentId, optionsDepartment.id))
        .where(eq(dispatchJobDepartment.jobId, jobId));
      return row ? withName(row) : undefined;
    },

    async getByJobIds(jobIds: string[]) {
      const map = new Map<string, DispatchJobDepartmentWithName>();
      if (jobIds.length === 0) return map;
      const client = getClient();
      const rows = await client
        .select({
          entry: dispatchJobDepartment,
          departmentName: optionsDepartment.name,
        })
        .from(dispatchJobDepartment)
        .leftJoin(optionsDepartment, eq(dispatchJobDepartment.departmentId, optionsDepartment.id))
        .where(inArray(dispatchJobDepartment.jobId, jobIds));
      for (const row of rows) {
        map.set(row.entry.jobId, withName(row));
      }
      return map;
    },

    async setForJob(jobId: string, departmentId: string) {
      const client = getClient();
      const [result] = await client
        .insert(dispatchJobDepartment)
        .values({ jobId, departmentId })
        .onConflictDoUpdate({
          target: dispatchJobDepartment.jobId,
          set: { departmentId },
        })
        .returning();
      return result;
    },

    async clearForJob(jobId: string) {
      const client = getClient();
      const deleted = await client
        .delete(dispatchJobDepartment)
        .where(eq(dispatchJobDepartment.jobId, jobId))
        .returning();
      return deleted.length > 0;
    },
  };
}
