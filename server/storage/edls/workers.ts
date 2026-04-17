import { getClient } from '../transaction-context';
import {
  workerEdls,
  workers,
  contacts,
  type WorkerEdls,
  type InsertWorkerEdls,
} from "@shared/schema";
import { eq } from "drizzle-orm";
import { type StorageLoggingConfig } from "../middleware/logging";

export interface WorkerEdlsStorage {
  getByWorker(workerId: string): Promise<WorkerEdls | undefined>;
  setActive(workerId: string, active: boolean): Promise<WorkerEdls>;
}

async function getWorkerName(workerId: string): Promise<string> {
  const client = getClient();
  const [worker] = await client
    .select({ contactId: workers.contactId, siriusId: workers.siriusId })
    .from(workers)
    .where(eq(workers.id, workerId));
  if (!worker) return 'Unknown Worker';

  const [contact] = await client
    .select({ given: contacts.given, family: contacts.family, displayName: contacts.displayName })
    .from(contacts)
    .where(eq(contacts.id, worker.contactId));

  const name = contact ? `${contact.given || ''} ${contact.family || ''}`.trim() : '';
  return name || contact?.displayName || `Worker #${worker.siriusId}`;
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
        const workerName = await getWorkerName(args[0]);
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
