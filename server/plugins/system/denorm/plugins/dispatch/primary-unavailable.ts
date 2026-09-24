import { registerDenormPlugin } from "../../registry";
import type { DenormPlugin } from "../../types";
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
 * `dispatch_primary_unavailable` denorm plugin — SAFETY-NET INTEGRITY SCAN.
 *
 * The "accepted primary dispatch ⇒ not available" rule is enforced as a hard
 * invariant elsewhere:
 *   - `storage.dispatches.setStatus`/`create` flip the worker to
 *     `not_available` in the same transaction that accepts a primary dispatch;
 *   - `storage` worker-status writes REJECT setting a worker to `available`
 *     while they hold an accepted primary (`WorkerOnPrimaryDispatchError`).
 *
 * This plugin therefore has NO event handlers. Its backfill is a periodic
 * integrity scan that finds workers who are `available` while holding an
 * accepted primary dispatch (e.g. rows predating the hard rule, or writes
 * that bypassed the storage layer) and enqueues them stale; the recompute
 * sweep then ratchets them to `not_available` via storage.
 *
 * Deliberately a ONE-WAY ratchet:
 *   - has accepted primary + status is not already `not_available`
 *       → upsertByWorker(..., "not_available")
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
 * automatically drops out of the eligible pool.
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
  // No event handlers: the invariant is enforced transactionally in the
  // dispatch/worker-status storage layer. This plugin is only a periodic
  // integrity scan (backfill) + widow cleanup.
  eventHandlers: [],

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
   * Integrity scan: workers whose dispatch status is `available` while they
   * hold an accepted+primary dispatch (invariant violators). The sweep
   * enqueues them stale (re-marking any existing denorm row); the recompute
   * sweep then runs `compute` + `write`, ratcheting them to `not_available`.
   */
  backfill(_configId: string, limit: number): Promise<string[]> {
    return storage.dispatches.findWorkerIdsAvailableWithAcceptedPrimary(limit);
  },

  /** Widows: denorm rows whose worker no longer exists. */
  findWidows(configId: string, limit: number): Promise<string[]> {
    return storage.workers.findDenormWidowIds(configId, limit);
  },
};

registerDenormPlugin(dispatchPrimaryUnavailableDenormPlugin);
