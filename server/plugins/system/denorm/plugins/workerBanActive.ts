import { registerDenormPlugin } from "../registry";
import type { DenormPlugin } from "../types";
import { EventType, eventBus } from "../../../../services/event-bus";
import { storage } from "../../../../storage";
import { onAfterCommit } from "../../../../storage/transaction-context";
import { calculateDenormActive } from "../../../../storage/utils/denorm-active";
import type { WorkerBan } from "@shared/schema";

/**
 * Payload for one ban's cached active flag. `ban: null` means the ban row no
 * longer exists (e.g. the WORKER_BAN_SAVED delete event raced us); the write
 * is then a no-op and the widow sweep removes the status row.
 */
export interface WorkerBanActivePayload {
  ban: WorkerBan | null;
  active: boolean;
}

/**
 * `worker_ban_active` denorm plugin — SOLE owner of the cached
 * `worker_bans.denorm_active` flag (a pure endDate-window cache; enforcement
 * always computes activity from live dates and never reads this flag).
 *
 * Lifecycle:
 *  - create/update/delete of a ban emits WORKER_BAN_SAVED → immediate recompute.
 *  - date rollover (a ban expiring) has no event; the hourly denorm backfill
 *    enqueues rows whose cached flag disagrees with the date window and the
 *    stale sweep repairs them (replacing the old daily worker-ban-active-scan).
 *  - when the flag actually flips, the write re-emits WORKER_BAN_SAVED AFTER
 *    COMMIT so the worker-level `dispatch_ban` facts recompute. The re-emit
 *    converges (second recompute finds no flip), so there is no loop.
 */
const workerBanActiveDenormPlugin: DenormPlugin<WorkerBanActivePayload> = {
  metadata: {
    id: "worker_ban_active",
    name: "Worker Ban Active Flag",
    description:
      "Maintains the cached denorm_active flag on worker bans from their date window",
    singleton: true,
  },
  entityType: "worker_ban",
  reads: ["workerBans"],
  writes: [{ storage: "workerBans", soleWriter: false }],
  eventHandlers: [
    {
      event: EventType.WORKER_BAN_SAVED,
      getEntityId: (payload) => (payload as { banId: string }).banId,
    },
  ],

  async compute(banId: string): Promise<WorkerBanActivePayload> {
    const ban = await storage.workerBans.get(banId);
    if (!ban) return { ban: null, active: false };
    // endDate-only window, matching the historical validator semantics
    // (future start dates are rejected at validation, so start is moot).
    return { ban, active: calculateDenormActive({ endDate: ban.endDate }) };
  },

  async write(banId: string, payload: WorkerBanActivePayload): Promise<void> {
    if (!payload.ban) return; // ban deleted; widow sweep cleans the status row
    if ((payload.ban.denormActive ?? true) === payload.active) return; // convergent no-op
    const updated = await storage.workerBans.setDenormActive(banId, payload.active);
    if (!updated) return;
    // Cascade: the worker's dispatch_ban facts depend on this flag's meaning
    // (an expired ban must drop its global fact). Emit after commit only, and
    // use the dedicated flip event so this plugin never re-triggers itself
    // and ban-saved side effects (notifications etc.) don't fire on rollover.
    onAfterCommit(() => {
      eventBus.emit(EventType.WORKER_BAN_DENORM_FLIPPED, {
        banId: updated.id,
        workerId: updated.workerId,
        active: updated.denormActive ?? true,
      });
    });
  },

  async backfill(configId: string, limit: number): Promise<string[]> {
    // Violators first (cached flag disagrees with the date window — the old
    // daily scan's queries), then bans with no status row yet.
    const [expiredButActive, notExpiredButInactive] = await Promise.all([
      storage.workerBans.findExpiredButActive(),
      storage.workerBans.findNotExpiredButInactive(),
    ]);
    const ids = [
      ...expiredButActive.map((b) => b.id),
      ...notExpiredButInactive.map((b) => b.id),
    ];
    if (ids.length < limit) {
      const missing = await storage.workerBans.findIdsMissingDenorm(
        configId,
        limit - ids.length,
      );
      ids.push(...missing);
    }
    return ids.slice(0, limit);
  },

  async findWidows(configId: string, limit: number): Promise<string[]> {
    return storage.workerBans.findDenormWidowIds(configId, limit);
  },
};

registerDenormPlugin(workerBanActiveDenormPlugin);
