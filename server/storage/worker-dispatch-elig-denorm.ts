import { createNoopValidator } from './utils/validation';
import { getClient } from './transaction-context';
import { workerDispatchEligDenorm, type InsertWorkerDispatchEligDenorm, type WorkerDispatchEligDenorm } from "@shared/schema";
import { eq, and } from "drizzle-orm";

/**
 * Stub validator - add validation logic here when needed
 */
export const validate = createNoopValidator();

export interface WorkerDispatchEligDenormStorage {
  getByWorker(workerId: string): Promise<WorkerDispatchEligDenorm[]>;
  getByWorkerAndCategory(workerId: string, category: string): Promise<WorkerDispatchEligDenorm[]>;
  getDistinctWorkersByCategory(category: string): Promise<string[]>;
  countByWorkerAndCategory(workerId: string, category: string): Promise<number>;
  create(entry: InsertWorkerDispatchEligDenorm): Promise<WorkerDispatchEligDenorm>;
  createMany(entries: InsertWorkerDispatchEligDenorm[]): Promise<WorkerDispatchEligDenorm[]>;
  deleteByWorkerAndCategory(workerId: string, category: string): Promise<number>;
}

export function createWorkerDispatchEligDenormStorage(): WorkerDispatchEligDenormStorage {
  return {
    async getByWorker(workerId: string) {
      const client = getClient();
      return await client
        .select()
        .from(workerDispatchEligDenorm)
        .where(eq(workerDispatchEligDenorm.workerId, workerId));
    },

    async getByWorkerAndCategory(workerId: string, category: string) {
      const client = getClient();
      return await client
        .select()
        .from(workerDispatchEligDenorm)
        .where(and(
          eq(workerDispatchEligDenorm.workerId, workerId),
          eq(workerDispatchEligDenorm.category, category)
        ));
    },

    async getDistinctWorkersByCategory(category: string): Promise<string[]> {
      const client = getClient();
      const result = await client
        .selectDistinct({ workerId: workerDispatchEligDenorm.workerId })
        .from(workerDispatchEligDenorm)
        .where(eq(workerDispatchEligDenorm.category, category));
      return result.map(r => r.workerId);
    },

    async countByWorkerAndCategory(workerId: string, category: string): Promise<number> {
      const client = getClient();
      const result = await client
        .select()
        .from(workerDispatchEligDenorm)
        .where(and(
          eq(workerDispatchEligDenorm.workerId, workerId),
          eq(workerDispatchEligDenorm.category, category)
        ));
      return result.length;
    },

    async create(entry: InsertWorkerDispatchEligDenorm) {
      validate.validateOrThrow(entry);
      const client = getClient();
      const [result] = await client
        .insert(workerDispatchEligDenorm)
        .values(entry)
        .returning();
      return result;
    },

    async createMany(entries: InsertWorkerDispatchEligDenorm[]) {
      validate.validateOrThrow(entries);
      const client = getClient();
      if (entries.length === 0) {
        return [];
      }
      return await client
        .insert(workerDispatchEligDenorm)
        .values(entries)
        .returning();
    },

    async deleteByWorkerAndCategory(workerId: string, category: string) {
      const client = getClient();
      const result = await client
        .delete(workerDispatchEligDenorm)
        .where(and(
          eq(workerDispatchEligDenorm.workerId, workerId),
          eq(workerDispatchEligDenorm.category, category)
        ))
        .returning();
      return result.length;
    }
  };
}
