import { registerDenormPlugin } from "../../registry";
import type { DenormPlugin } from "../../types";
import { EventType } from "../../../../../services/event-bus";
import { storage } from "../../../../../storage";
import { createWorkerDispatchStatusStorage } from "../../../../../storage/dispatch/worker-status";

/**
 * Denorm payload: whether the worker currently holds an accepted primary
 * dispatch. No payload table exists for this plugin — `write` reacts by
 * (possibly) mutating the shared `worker_dispatch_status` row.
 */
export interface PrimaryUnavailableDenormPayload {
  hasAcceptedPrimary: boolean;
}

/**
 * `dispatch_primary_unavailable` denorm plugin — a worker who has accepted a
 * PRIMARY dispatch is, in general, not available for other dispatches, so this
 * plugin sets their dispatch status to `not_available`.
 *
 * Deliberately a ONE-WAY ratchet:
 *   - has accepted primary + status is not already `not_available`
 *       → `storage.workerDispatchStatus.upsertByWorker(..., "not_available")`
 *   - otherwise → no-op. Nothing here ever sets a worker back to `available`;
 *     a future "auto-sign-in" tool will own that direction.
 *
 * The write target is SHARED domain state (`workerDispatchStatus`, mutated by
 * routes and other code too), hence `soleWriter: false` and the convergent
 * diff-check-first write: recomputes are safe to re-run at any time and no-op
 * when the status is already correct.
 *
 * Setting the status through storage emits `DISPATCH_STATUS_SAVED`, which the
 * `dispatch_status` eligibility denorm plugin already consumes — the worker
 * automatically drops out of the eligible pool. No event loop: this plugin
 * listens to `DISPATCH_SAVED` only.
 */
export const dispatchPrimaryUnavailableDenormPlugin: DenormPlugin<PrimaryUnavailableDenormPayload> = {
  metadata: {
    id: "dispatch_primary_unavailable",
    name: "Primary Dispatch Sign-Out",
    description:
      "Sets a worker's dispatch status to Not Available when they accept a primary dispatch. One-way: never sets anyone back to Available.",
    requiredComponent: "dispatch",
    singleton: true,
  },
  entityType: "worker",
  reads: ["dispatches", "workers", "workerDispatchStatus"],
  writes: [{ storage: "workerDispatchStatus", soleWriter: false }],
  eventHandlers: [
    {
      event: EventType.DISPATCH_SAVED,
      getEntityId: (payload) => (payload as { workerId: string }).workerId,
    },
  ],

  async compute(workerId: string): Promise<PrimaryUnavailableDenormPayload> {
    const hasAcceptedPrimary = await storage.dispatches.hasAcceptedPrimary(workerId);
    return { hasAcceptedPrimary };
  },

  async write(workerId: string, payload: PrimaryUnavailableDenormPayload): Promise<void> {
    if (!payload.hasAcceptedPrimary) {
      // One-way ratchet: absence of a primary dispatch never flips a worker
      // back to available.
      return;
    }
    const statusStorage = createWorkerDispatchStatusStorage();
    const current = await statusStorage.getByWorker(workerId);
    if (current?.status === "not_available") {
      // Convergent no-op: already correct.
      return;
    }
    await statusStorage.upsertByWorker(workerId, { status: "not_available" });
  },

  /**
   * Backfill: workers with an existing accepted+primary dispatch but no denorm
   * row for this config. The registry enqueues them stale; the recompute sweep
   * then runs `compute` + `write` (event path handles new accepts immediately).
   */
  backfill(configId: string, limit: number): Promise<string[]> {
    return storage.dispatches.findWorkerIdsWithAcceptedPrimaryMissingDenorm(configId, limit);
  },

  /** Widows: denorm rows whose worker no longer exists. */
  findWidows(configId: string, limit: number): Promise<string[]> {
    return storage.workers.findDenormWidowIds(configId, limit);
  },
};

registerDenormPlugin(dispatchPrimaryUnavailableDenormPlugin);
