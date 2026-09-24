import { registerDenormPlugin } from "../registry";
import type { DenormPlugin } from "../types";
import { EventType } from "../../../../services/event-bus";
import { storage } from "../../../../storage";

/**
 * Denorm payload for a worker's current work status: the latest work status,
 * derived from the work-status history (`worker_wsh`). A worker has exactly ONE
 * current work status, so the payload is a single nullable `wsId` (null when the
 * worker has no work-status history).
 */
export interface WorkerWsDenorm {
  wsId: string | null;
}

/**
 * `worker_ws` denorm plugin — sole maintainer of the `worker_wsh_denorm` table.
 *
 * Subscribes to WORKER_WSH_SAVED (emitted after a work-status history change
 * commits). On each event the registry recomputes the worker's current work
 * status from history and routes it through the shared apply helper, which marks
 * the `denorm` status row `ok` and calls this plugin's payload-only `write`
 * (both in one transaction). The plugin itself only replaces the worker's single
 * `worker_wsh_denorm` payload row; the wrapper owns the status row.
 */
const workerWsDenormPlugin: DenormPlugin<WorkerWsDenorm> = {
  metadata: {
    id: "worker_ws",
    name: "Worker Work Status",
    description:
      "Keeps a worker's denormalized current work status (latest work status) in sync from work-status history.",
    singleton: true,
  },
  entityType: "worker",
  reads: ["workers", "workerWsh"],
  writes: [{ storage: "workerWshDenorm", soleWriter: true }],
  eventHandlers: [
    {
      event: EventType.WORKER_WSH_SAVED,
      getEntityId: (payload) => (payload as { workerId: string }).workerId,
    },
  ],

  async compute(workerId: string): Promise<WorkerWsDenorm> {
    const wsId = await storage.workerWsh.getCurrentWorkStatusId(workerId);
    return { wsId };
  },

  async backfill(configId: string, limit: number): Promise<string[]> {
    // Every worker should have a worker_ws denorm row; return those that don't
    // yet (read-only anti-join). The registry enqueues them as `stale`.
    return storage.workers.findIdsMissingDenorm(configId, limit);
  },

  async findWidows(configId: string, limit: number): Promise<string[]> {
    // denorm rows whose worker no longer exists (read-only anti-join). The
    // wrapper deletes them; the dependent worker_wsh_denorm row cascades away.
    return storage.workers.findDenormWidowIds(configId, limit);
  },

  async write(workerId: string, payload: WorkerWsDenorm, denormRowId: string): Promise<void> {
    // Payload-only: the wrapper (`applyComputed`) has already upserted the
    // `denorm` status row to `ok` and supplies its id. We only replace the
    // worker's single `worker_wsh_denorm` payload row, which FK-references that
    // id. setForWorker inserts at most one row (none when wsId is null) and
    // emits WORKER_WS_CHANGED post-commit when the value actually changes.
    await storage.workerWshDenorm.setForWorker(workerId, denormRowId, payload.wsId);
  },
};

registerDenormPlugin(workerWsDenormPlugin);
