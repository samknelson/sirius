import { getClient } from '../transaction-context';
import { workerMshDenorm, type WorkerMshDenorm } from "@shared/schema";
import { eq } from "drizzle-orm";

/**
 * Storage for the `worker_msh_denorm` payload table — the denormalized set of a
 * worker's current member statuses (one row per industry's latest status). This
 * is the SOLE writer of the table; rows are maintained exclusively by the
 * `worker_ms` denorm plugin via {@link replaceForWorker}.
 */
export interface WorkerMshDenormStorage {
  /** All denorm rows for a worker. */
  getByWorker(workerId: string): Promise<WorkerMshDenorm[]>;
  /**
   * Replace the full set of current member statuses for a worker: delete the
   * existing rows and insert one row per `msId`. Caller is responsible for
   * wrapping this in a transaction together with the matching `denorm` status
   * upsert so the two stay consistent.
   */
  replaceForWorker(workerId: string, denormId: string, msIds: string[]): Promise<void>;
}

export function createWorkerMshDenormStorage(): WorkerMshDenormStorage {
  return {
    async getByWorker(workerId: string): Promise<WorkerMshDenorm[]> {
      const client = getClient();
      return client
        .select()
        .from(workerMshDenorm)
        .where(eq(workerMshDenorm.workerId, workerId));
    },

    async replaceForWorker(workerId: string, denormId: string, msIds: string[]): Promise<void> {
      const client = getClient();
      await client.delete(workerMshDenorm).where(eq(workerMshDenorm.workerId, workerId));
      // De-dupe defensively: the unique (worker_id, ms_id) index would reject
      // duplicate ms ids, and a worker can in principle share one status across
      // industries.
      const uniqueMsIds = Array.from(new Set(msIds));
      if (uniqueMsIds.length > 0) {
        await client.insert(workerMshDenorm).values(
          uniqueMsIds.map((msId) => ({ denormId, workerId, msId })),
        );
      }
    },
  };
}
