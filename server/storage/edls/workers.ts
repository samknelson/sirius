import { getClient } from '../transaction-context';
import {
  workerEdls,
  type WorkerEdls,
  type InsertWorkerEdls,
} from "@shared/schema";
import { eq } from "drizzle-orm";
import { type StorageLoggingConfig } from "../middleware/logging";

export interface WorkerEdlsStorage {
  getByWorker(workerId: string): Promise<WorkerEdls | undefined>;
  setActive(workerId: string, active: boolean): Promise<WorkerEdls>;
  ensure(workerId: string): Promise<WorkerEdls>;
}

export function createWorkerEdlsStorage(): WorkerEdlsStorage {
  return {
    async getByWorker(workerId: string): Promise<WorkerEdls | undefined> {
      const client = getClient();
      const [row] = await client
        .select()
        .from(workerEdls)
        .where(eq(workerEdls.workerId, workerId));
      return row;
    },

    async setActive(workerId: string, active: boolean): Promise<WorkerEdls> {
      const client = getClient();
      const [existing] = await client
        .select()
        .from(workerEdls)
        .where(eq(workerEdls.workerId, workerId));

      if (existing) {
        const [updated] = await client
          .update(workerEdls)
          .set({ active })
          .where(eq(workerEdls.workerId, workerId))
          .returning();
        return updated;
      }

      const insertValue: InsertWorkerEdls = { workerId, active };
      const [created] = await client
        .insert(workerEdls)
        .values(insertValue)
        .returning();
      return created;
    },
    async ensure(workerId: string): Promise<WorkerEdls> {
      const existing = await this.getByWorker(workerId);
      if (existing) return existing;
      return this.setActive(workerId, true);
    },
  };
}

export const workerEdlsLoggingConfig: StorageLoggingConfig<WorkerEdlsStorage> = {
  module: 'worker-edls',
  methods: {
    setActive: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: (args) => args[0],
      before: async (args, storage) => {
        const row = await storage.getByWorker(args[0]);
        return { row };
      },
      getDescription: async (args, result, beforeState) => {
        const { storage } = await import('../index');
        const workerName = await storage.workers.getWorkerDisplayName(args[0]);
        const prev = beforeState?.row?.active;
        const next = result?.active;
        if (prev === next) {
          return `EDLS active unchanged (${next ? 'active' : 'inactive'}) for ${workerName}`;
        }
        return `Set EDLS ${next ? 'active' : 'inactive'} for ${workerName}`;
      },
      after: async (args, result) => {
        return { row: result };
      },
    },
  },
};
