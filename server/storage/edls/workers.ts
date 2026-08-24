import { getClient } from '../transaction-context';
import {
  workerEdls,
  type WorkerEdls,
  type InsertWorkerEdls,
} from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { type StorageLoggingConfig } from "../middleware/logging";

export interface WorkerEdlsStorage {
  getByWorker(workerId: string): Promise<WorkerEdls | undefined>;
  /**
   * Whether this worker has ANY EDLS presence: a `worker_edls` row — active
   * or not — or at least one assignment, on any sheet, at any date.
   *
   * Deliberately broader than the scheduling population `worker_edls.active`
   * describes. It answers "is EDLS any of this person's business", which is
   * what the public schedule page gates on: a worker taken off a sheet, or
   * dropped from the population, still has a schedule to look at, while a
   * worker who has never been near EDLS must not become readable to anyone
   * who learns their id from an unrelated screen.
   */
  hasEdlsPresence(workerId: string): Promise<boolean>;
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

    async hasEdlsPresence(workerId: string): Promise<boolean> {
      const client = getClient();
      // One round trip, and no row bodies: the caller only needs the yes/no,
      // and either half alone would answer wrongly — a population row can be
      // removed from a worker who is still on sheets, and a worker can be
      // added to the population before their first assignment exists.
      const result = await client.execute(sql`
        SELECT
          EXISTS (SELECT 1 FROM worker_edls we WHERE we.worker_id = ${workerId})
          OR EXISTS (SELECT 1 FROM edls_assignments ea WHERE ea.worker_id = ${workerId})
          AS "present"
      `);
      return (result.rows[0] as { present: boolean } | undefined)?.present === true;
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
