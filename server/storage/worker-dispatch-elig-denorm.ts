import { getClient } from './transaction-context';
import { workerDispatchEligDenorm, type InsertWorkerDispatchEligDenorm, type WorkerDispatchEligDenorm } from "@shared/schema";
import { eq, and } from "drizzle-orm";

export interface WorkerDispatchEligDenormStorage {
  getByWorker(workerId: string): Promise<WorkerDispatchEligDenorm[]>;
  getByWorkerAndCategory(workerId: string, category: string): Promise<WorkerDispatchEligDenorm[]>;
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

    async create(entry: InsertWorkerDispatchEligDenorm) {
      const client = getClient();
      const [result] = await client
        .insert(workerDispatchEligDenorm)
        .values(entry)
        .returning();
      return result;
    },

    async createMany(entries: InsertWorkerDispatchEligDenorm[]) {
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
