import { registerDenormPlugin } from "../../registry";
import type { DenormPlugin } from "../../types";
import { EventType } from "../../../../../services/event-bus";
import { storage } from "../../../../../storage";
import { createWorkerDispatchAsiStorage } from "../../../../../storage/dispatch/worker-asi";
import { createWorkerDispatchStatusStorage } from "../../../../../storage/dispatch/worker-status";

/**
 * Denorm payload: whether the triggering dispatch save was a transition OUT
 * of "accepted" (the only trigger this plugin cares about), plus the dispatch
 * id so `write` can verify the dispatch is primary. No payload table exists —
 * `write` reacts by (possibly) mutating the shared `worker_dispatch_status`
 * row.
 */
export interface AsiSignInDenormPayload {
  /** True only when the event was a status change FROM "accepted" to something else. */
  leftAccepted: boolean;
  /** The dispatch that changed, for the primary check. */
  dispatchId?: string;
}

/**
 * `dispatch_asi` denorm plugin — Auto Sign-In. The counterpart to
 * `dispatch_primary_unavailable` (which one-way ratchets a worker to
 * `not_available` when they accept a primary dispatch): when a worker who has
 * Auto Sign-In enabled loses their accepted PRIMARY dispatch (its status
 * moves FROM `accepted` TO anything else), this plugin signs them back in by
 * setting their dispatch status to `available`.
 *
 * Deliberately EVENT-REACTIVE ONLY (a "partial" denorm):
 *   - The trigger is a transition, not a state, so it can only be observed on
 *     the event (`previousStatus === "accepted" && status !== "accepted"`).
 *     `getPayload` derives it from the DISPATCH_SAVED payload.
 *   - `compute` (used by recompute sweeps) always returns a no-op payload:
 *     a manual status change made AFTER the auto sign-in must stick — a sweep
 *     must never re-force `available`.
 *   - No `backfill` / `findWidows`: historical dispatches are intentionally
 *     not replayed.
 *
 * Guards in `write`: dispatch must be primary, the worker's ASI flag must be
 * on, and the write is convergent (no-op when already `available`). The write
 * target is SHARED domain state, hence `soleWriter: false`.
 *
 * No event loop: setting the status emits DISPATCH_STATUS_SAVED, which this
 * plugin does not listen to.
 */
export const dispatchAsiSignInDenormPlugin: DenormPlugin<AsiSignInDenormPayload> = {
  metadata: {
    id: "dispatch_asi",
    name: "Auto Sign-In",
    description:
      "Sets a worker's dispatch status back to Available when their accepted primary dispatch ends, if the worker has Auto Sign-In enabled.",
    requiredComponent: "dispatch.asi",
    singleton: true,
  },
  entityType: "worker",
  reads: ["dispatches", "workerDispatchAsi", "workerDispatchStatus"],
  writes: [{ storage: "workerDispatchStatus", soleWriter: false }],
  eventHandlers: [
    {
      event: EventType.DISPATCH_SAVED,
      getEntityId: (payload) => (payload as { workerId: string }).workerId,
      getPayload: (payload) => {
        const p = payload as {
          dispatchId?: string;
          status?: string;
          previousStatus?: string;
        };
        return {
          leftAccepted: p.previousStatus === "accepted" && p.status !== "accepted",
          dispatchId: p.dispatchId,
        };
      },
    },
  ],

  /**
   * Sweeps / recomputes are intentionally inert: the trigger is a transition
   * only observable on the event, and re-forcing `available` later would
   * fight manual status changes.
   */
  async compute(_workerId: string): Promise<AsiSignInDenormPayload> {
    return { leftAccepted: false };
  },

  async write(workerId: string, payload: AsiSignInDenormPayload): Promise<void> {
    if (!payload.leftAccepted || !payload.dispatchId) {
      return;
    }
    const dispatch = await storage.dispatches.get(payload.dispatchId);
    if (!dispatch?.isPrimary) {
      // Only losing a PRIMARY dispatch triggers auto sign-in.
      return;
    }
    const asiStorage = createWorkerDispatchAsiStorage();
    const asi = await asiStorage.getByWorker(workerId);
    if (!asi?.asi) {
      // Worker has not opted in to Auto Sign-In.
      return;
    }
    const statusStorage = createWorkerDispatchStatusStorage();
    const current = await statusStorage.getByWorker(workerId);
    if (current?.status === "available") {
      // Convergent no-op: already correct.
      return;
    }
    await statusStorage.upsertByWorker(workerId, { status: "available" });
  },
};

registerDenormPlugin(dispatchAsiSignInDenormPlugin);
