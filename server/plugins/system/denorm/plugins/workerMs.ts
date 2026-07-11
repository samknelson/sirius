import { registerDenormPlugin } from "../registry";
import type { DenormPlugin } from "../types";
import { EventType } from "../../../../services/event-bus";
import { storage } from "../../../../storage";

/**
 * Denorm payload for a worker's current member statuses: the latest member
 * status per industry, derived from the member-status history (`worker_msh`).
 */
export interface WorkerMsDenorm {
  msIds: string[];
}

/**
 * `worker_ms` denorm plugin — sole maintainer of the `worker_msh_denorm` table.
 *
 * Subscribes to WORKER_MSH_SAVED (emitted after a member-status history change
 * commits). On each event the registry recomputes the worker's current member
 * statuses from history and routes them through the shared apply helper, which
 * marks the `denorm` status row `ok` and calls this plugin's payload-only
 * `write` (both in one transaction). The plugin itself only replaces the
 * worker's `worker_msh_denorm` payload rows; the wrapper owns the status row.
 */
const workerMsDenormPlugin: DenormPlugin<WorkerMsDenorm> = {
  metadata: {
    id: "worker_ms",
    name: "Worker Member Statuses",
    description:
      "Keeps a worker's denormalized current member statuses (latest status per industry) in sync from member-status history.",
    singleton: true,
  },
  entityType: "worker",
  reads: ["workers", "workerMsh"],
  writes: [{ storage: "workerMshDenorm", soleWriter: true }],
  eventHandlers: [
    {
      event: EventType.WORKER_MSH_SAVED,
      getEntityId: (payload) => (payload as { workerId: string }).workerId,
    },
  ],

  async compute(workerId: string): Promise<WorkerMsDenorm> {
    const msIds = await storage.workerMsh.getCurrentMemberStatusIds(workerId);
    return { msIds };
  },

  async backfill(configId: string, limit: number): Promise<string[]> {
    // Every worker should have a worker_ms denorm row; return those that don't
    // yet (read-only anti-join). The registry enqueues them as `stale`.
    return storage.workers.findIdsMissingDenorm(configId, limit);
  },

  async findWidows(configId: string, limit: number): Promise<string[]> {
    // denorm rows whose worker no longer exists (read-only anti-join). The
    // wrapper deletes them; dependent worker_msh_denorm rows cascade away.
    return storage.workers.findDenormWidowIds(configId, limit);
  },

  async write(workerId: string, payload: WorkerMsDenorm, denormRowId: string): Promise<void> {
    // Payload-only: the wrapper (`applyComputed`) has already upserted the
    // `denorm` status row to `ok` and supplies its id. We only replace the
    // worker's `worker_msh_denorm` payload rows, which FK-reference that id.
    await storage.workerMshDenorm.replaceForWorker(workerId, denormRowId, payload.msIds);
  },
};

registerDenormPlugin(workerMsDenormPlugin);
