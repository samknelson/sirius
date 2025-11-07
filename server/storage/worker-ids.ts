import { db } from "../db";
import { workerIds, type WorkerId, type InsertWorkerId } from "@shared/schema";
import { eq } from "drizzle-orm";

export interface WorkerIdStorage {
  getWorkerIdsByWorkerId(workerId: string): Promise<WorkerId[]>;
  getWorkerId(id: string): Promise<WorkerId | undefined>;
  createWorkerId(workerId: InsertWorkerId): Promise<WorkerId>;
  updateWorkerId(id: string, workerId: Partial<InsertWorkerId>): Promise<WorkerId | undefined>;
  deleteWorkerId(id: string): Promise<boolean>;
}

export function createWorkerIdStorage(): WorkerIdStorage {
  return {
    async getWorkerIdsByWorkerId(workerId: string): Promise<WorkerId[]> {
      return db.select().from(workerIds).where(eq(workerIds.workerId, workerId));
    },

    async getWorkerId(id: string): Promise<WorkerId | undefined> {
      const [workerId] = await db.select().from(workerIds).where(eq(workerIds.id, id));
      return workerId || undefined;
    },

    async createWorkerId(insertWorkerId: InsertWorkerId): Promise<WorkerId> {
      const [workerId] = await db
        .insert(workerIds)
        .values(insertWorkerId)
        .returning();
      return workerId;
    },

    async updateWorkerId(id: string, workerIdUpdate: Partial<InsertWorkerId>): Promise<WorkerId | undefined> {
      const [workerId] = await db
        .update(workerIds)
        .set(workerIdUpdate)
        .where(eq(workerIds.id, id))
        .returning();
      return workerId || undefined;
    },

    async deleteWorkerId(id: string): Promise<boolean> {
      const result = await db.delete(workerIds).where(eq(workerIds.id, id)).returning();
      return result.length > 0;
    }
  };
}
