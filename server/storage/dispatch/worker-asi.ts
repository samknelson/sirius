import { createNoopValidator } from '../utils/validation';
import { getClient } from '../transaction-context';
import {
  workerDispatchAsi,
  type WorkerDispatchAsi,
} from "@shared/schema";
import { eq } from "drizzle-orm";
import { type StorageLoggingConfig } from "../middleware/logging";

export const validate = createNoopValidator();

export interface WorkerDispatchAsiStorage {
  getByWorker(workerId: string): Promise<WorkerDispatchAsi | undefined>;
  upsertByWorker(workerId: string, asi: boolean): Promise<WorkerDispatchAsi>;
}

export const workerDispatchAsiLoggingConfig: StorageLoggingConfig<WorkerDispatchAsiStorage> = {
  module: 'worker-dispatch-asi',
  methods: {
    upsertByWorker: {
      enabled: true,
      getEntityId: (args, result) => result?.id,
      getHostEntityId: (args, result) => result?.workerId || args[0],
      getDescription: async (args, result) => {
        const { storage } = await import('../index');
        const workerName = await storage.workers.getWorkerDisplayName(result?.workerId || args[0]);
        return `Set auto sign-in to "${result?.asi ? 'on' : 'off'}" for ${workerName}`;
      },
      after: async (args, result) => {
        return { asi: result };
      }
    }
  }
};

export function createWorkerDispatchAsiStorage(): WorkerDispatchAsiStorage {
  return {
    async getByWorker(workerId: string) {
      const client = getClient();
      const [entry] = await client
        .select()
        .from(workerDispatchAsi)
        .where(eq(workerDispatchAsi.workerId, workerId));
      return entry;
    },

    async upsertByWorker(workerId: string, asi: boolean) {
      const client = getClient();
      const [result] = await client
        .insert(workerDispatchAsi)
        .values({ workerId, asi })
        .onConflictDoUpdate({
          target: workerDispatchAsi.workerId,
          set: { asi },
        })
        .returning();
      return result;
    },
  };
}
