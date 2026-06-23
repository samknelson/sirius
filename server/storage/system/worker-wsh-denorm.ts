import { getClient, onAfterCommit } from '../transaction-context';
import { workerWshDenorm, type WorkerWshDenorm } from "@shared/schema";
import { eq } from "drizzle-orm";
import { eventBus, EventType } from "../../services/event-bus";
import { logger } from "../../logger";

/**
 * Storage for the `worker_wsh_denorm` payload table — the denormalized current
 * work status of a worker. A worker has exactly ONE current work status, so the
 * table holds at most one row per worker (unique on `worker_id`); the row is
 * only present when the worker has a work status. This is the SOLE writer of the
 * table; rows are maintained exclusively by the `worker_ws` denorm plugin via
 * {@link setForWorker}.
 */
export interface WorkerWshDenormStorage {
  /** The single denorm row for a worker, if any. */
  getByWorker(workerId: string): Promise<WorkerWshDenorm | undefined>;
  /**
   * Replace the worker's current work status: delete the existing row and insert
   * a single new row only when `wsId` is non-null (no row means "no work
   * status"). Caller is responsible for wrapping this in a transaction together
   * with the matching `denorm` status upsert so the two stay consistent.
   *
   * Emits WORKER_WS_CHANGED (after the surrounding transaction commits) when the
   * worker's current work status actually changes, so downstream consumers such
   * as dispatch eligibility react. The event fires post-commit so handlers read
   * the freshly-written value.
   */
  setForWorker(workerId: string, denormId: string, wsId: string | null): Promise<void>;
}

export function createWorkerWshDenormStorage(): WorkerWshDenormStorage {
  return {
    async getByWorker(workerId: string): Promise<WorkerWshDenorm | undefined> {
      const client = getClient();
      const [row] = await client
        .select()
        .from(workerWshDenorm)
        .where(eq(workerWshDenorm.workerId, workerId));
      return row || undefined;
    },

    async setForWorker(workerId: string, denormId: string, wsId: string | null): Promise<void> {
      const client = getClient();

      const [existing] = await client
        .select({ wsId: workerWshDenorm.wsId })
        .from(workerWshDenorm)
        .where(eq(workerWshDenorm.workerId, workerId));
      const previousWsId = existing?.wsId ?? null;

      await client.delete(workerWshDenorm).where(eq(workerWshDenorm.workerId, workerId));
      if (wsId !== null) {
        await client.insert(workerWshDenorm).values({ denormId, workerId, wsId });
      }

      if (previousWsId !== wsId) {
        onAfterCommit(() => {
          void eventBus
            .emit(EventType.WORKER_WS_CHANGED, { workerId, wsId, previousWsId })
            .catch((err) => {
              logger.error("Failed to emit WORKER_WS_CHANGED", {
                service: "worker-wsh-denorm",
                workerId,
                error: err instanceof Error ? err.message : String(err),
              });
            });
        });
      }
    },
  };
}
