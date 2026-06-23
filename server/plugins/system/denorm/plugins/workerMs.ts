import { registerDenormPlugin } from "../registry";
import type { DenormPlugin } from "../types";
import { EventType } from "../../../../services/event-bus";
import { storage } from "../../../../storage";
import { runInTransaction } from "../../../../storage/transaction-context";
import { logger } from "../../../../logger";

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
 * commits). On each event it recomputes the worker's current member statuses
 * from history and replaces the worker's `worker_msh_denorm` rows, recording an
 * `ok` status in `denorm`. The two writes share one transaction so the payload
 * rows and their status stay consistent.
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

  async write(workerId: string, payload: WorkerMsDenorm): Promise<void> {
    const configs = await storage.pluginConfigs.getByKindAndPlugin("denorm", "worker_ms");
    const config = configs[0];
    if (!config) {
      logger.error("worker_ms denorm config not found; skipping write", {
        service: "denorm-worker-ms",
        workerId,
      });
      return;
    }

    await runInTransaction(async () => {
      const denormRow = await storage.denorm.upsertStatus({
        entityId: workerId,
        entityType: "worker",
        configId: config.id,
        status: "ok",
        computedAt: new Date(),
      });
      await storage.workerMshDenorm.replaceForWorker(workerId, denormRow.id, payload.msIds);
    });
  },
};

registerDenormPlugin(workerMsDenormPlugin);
