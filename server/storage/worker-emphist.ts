import { db } from "../db";
import { workerEmphist, type WorkerEmphist, type InsertWorkerEmphist } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";

export interface WorkerEmphistStorage {
  getWorkerEmphistByWorkerId(workerId: string): Promise<WorkerEmphist[]>;
  getWorkerEmphist(id: string): Promise<WorkerEmphist | undefined>;
  createWorkerEmphist(emphist: InsertWorkerEmphist): Promise<WorkerEmphist>;
  updateWorkerEmphist(id: string, emphist: Partial<InsertWorkerEmphist>): Promise<WorkerEmphist | undefined>;
  deleteWorkerEmphist(id: string): Promise<boolean>;
}

export function createWorkerEmphistStorage(): WorkerEmphistStorage {
  return {
    async getWorkerEmphistByWorkerId(workerId: string): Promise<WorkerEmphist[]> {
      return db
        .select()
        .from(workerEmphist)
        .where(eq(workerEmphist.workerId, workerId))
        .orderBy(desc(workerEmphist.date));
    },

    async getWorkerEmphist(id: string): Promise<WorkerEmphist | undefined> {
      const [emphist] = await db
        .select()
        .from(workerEmphist)
        .where(eq(workerEmphist.id, id));
      return emphist || undefined;
    },

    async createWorkerEmphist(insertEmphist: InsertWorkerEmphist): Promise<WorkerEmphist> {
      const [emphist] = await db
        .insert(workerEmphist)
        .values(insertEmphist)
        .returning();
      return emphist;
    },

    async updateWorkerEmphist(id: string, emphistUpdate: Partial<InsertWorkerEmphist>): Promise<WorkerEmphist | undefined> {
      const [emphist] = await db
        .update(workerEmphist)
        .set(emphistUpdate)
        .where(eq(workerEmphist.id, id))
        .returning();
      return emphist || undefined;
    },

    async deleteWorkerEmphist(id: string): Promise<boolean> {
      const result = await db
        .delete(workerEmphist)
        .where(eq(workerEmphist.id, id))
        .returning();
      return result.length > 0;
    }
  };
}
