import { registerDenormPlugin } from "../../registry";
import type { DenormPlugin } from "../../types";
import { EventType } from "../../../../../services/event-bus";
import { storage } from "../../../../../storage";

const PLUGIN_ID = "dispatch_job_event";

/**
 * Payload is intentionally trivial: all bullpen resolution (job → job type →
 * `bullpen === "host"` → `bullpenEventTypeId`) lives in the
 * `storage.dispatchJobEvents.upsertForJob` write path so it runs inside the
 * same transaction that creates the event + link row.
 */
export interface DispatchJobEventDenormPayload {
  jobId: string;
}

/**
 * `dispatch_job_event` denorm plugin — auto-creates a linked event for every
 * dispatch job whose type is a bullpen HOST. Gated by the `dispatch.bullpen`
 * component (which owns the `dispatch_job_event` table).
 *
 *   - event-driven: every DISPATCH_JOB_SAVED (after-commit) syncs that job;
 *   - backfill: enqueues host jobs that have no link row yet;
 *   - widow sweep: retires denorm rows whose job is gone or whose type is no
 *     longer a host (the FK cascade from `denorm` drops the link row; the
 *     created `events` row is deliberately left in place).
 *
 * Non-host jobs saved through the event handler get an `ok` denorm row whose
 * write was a no-op; the next widow sweep removes it.
 */
const dispatchJobEventDenormPlugin: DenormPlugin<DispatchJobEventDenormPayload> = {
  metadata: {
    id: PLUGIN_ID,
    name: "Bullpen Job Events",
    description:
      "Automatically creates and links an event (of the job type's configured bullpen event type) for every dispatch job whose type hosts a bullpen.",
    requiredComponent: "dispatch.bullpen",
    singleton: true,
  },
  entityType: "dispatch-job",
  reads: [],
  writes: [{ storage: "dispatchJobEvents", soleWriter: true }],
  eventHandlers: [
    {
      event: EventType.DISPATCH_JOB_SAVED,
      getEntityId: (payload) => (payload as { jobId: string }).jobId,
    },
  ],

  async compute(jobId: string): Promise<DispatchJobEventDenormPayload> {
    return { jobId };
  },

  async backfill(_configId: string, limit: number): Promise<string[]> {
    return storage.dispatchJobEvents.listHostJobIdsMissingEvent(limit);
  },

  async findWidows(configId: string, limit: number): Promise<string[]> {
    const entityIds = await storage.denorm.listEntityIdsForConfig(configId, limit);
    if (entityIds.length === 0) return [];
    const stillHosts = new Set(
      await storage.dispatchJobEvents.filterHostJobIds(entityIds),
    );
    return entityIds.filter((id) => !stillHosts.has(id));
  },

  async write(
    entityId: string,
    _payload: DispatchJobEventDenormPayload,
    denormRowId: string,
  ): Promise<void> {
    await storage.dispatchJobEvents.upsertForJob(entityId, denormRowId);
  },
};

registerDenormPlugin(dispatchJobEventDenormPlugin);
