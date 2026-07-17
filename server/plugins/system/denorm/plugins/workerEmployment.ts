import { registerDenormPlugin } from "../registry";
import type { DenormPlugin } from "../types";
import { EventType } from "../../../../services/event-bus";
import { storage } from "../../../../storage";
import type { WorkerEmploymentRow } from "../../../../storage/system/worker-employment-denorm";

/**
 * Denorm payload for a worker's current employment: one row per employer (that
 * employer's latest employment), derived from hours history (`worker_hours`).
 * Exactly one row carries `home = true`, and `job_title` is stored on every row.
 */
export interface WorkerEmploymentDenormPayload {
  rows: WorkerEmploymentRow[];
}

/**
 * `worker_employment` denorm plugin — sole maintainer of the
 * `worker_employment_denorm` table.
 *
 * Subscribes to HOURS_SAVED (emitted after an hours change commits). On each
 * event the registry recomputes the worker's current employment from hours
 * history and routes it through the shared apply helper, which marks the `denorm`
 * status row `ok` and calls this plugin's payload-only `write` (both in one
 * transaction). The plugin itself only replaces the worker's
 * `worker_employment_denorm` payload rows; the wrapper owns the status row.
 */
const workerEmploymentDenormPlugin: DenormPlugin<WorkerEmploymentDenormPayload> = {
  metadata: {
    id: "worker_employment",
    name: "Worker Employment",
    description:
      "Keeps a worker's denormalized current employment (latest employment per employer, home employer, and job title) in sync from hours history.",
    singleton: true,
  },
  entityType: "worker",
  reads: ["workers", "workerHours"],
  writes: [{ storage: "workerEmploymentDenorm", soleWriter: true }],
  eventHandlers: [
    {
      event: EventType.HOURS_SAVED,
      getEntityId: (payload) => (payload as { workerId: string }).workerId,
    },
  ],

  async compute(workerId: string): Promise<WorkerEmploymentDenormPayload> {
    const rows = await storage.workerHours.getCurrentEmployment(workerId);
    return { rows };
  },

  async backfill(configId: string, limit: number): Promise<string[]> {
    // Every worker should have a worker_employment denorm row; return those that
    // don't yet (read-only anti-join). The registry enqueues them as `stale`.
    return storage.workers.findIdsMissingDenorm(configId, limit);
  },

  async findWidows(configId: string, limit: number): Promise<string[]> {
    // denorm rows whose worker no longer exists (read-only anti-join). The
    // wrapper deletes them; dependent worker_employment_denorm rows cascade away.
    return storage.workers.findDenormWidowIds(configId, limit);
  },

  async write(workerId: string, payload: WorkerEmploymentDenormPayload, denormRowId: string): Promise<void> {
    // Payload-only: the wrapper (`applyComputed`) has already upserted the
    // `denorm` status row to `ok` and supplies its id. We only replace the
    // worker's `worker_employment_denorm` payload rows, which FK-reference that id.
    await storage.workerEmploymentDenorm.replaceForWorker(workerId, denormRowId, payload.rows);
  },
};

registerDenormPlugin(workerEmploymentDenormPlugin);
