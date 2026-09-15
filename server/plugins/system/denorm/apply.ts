import { storage } from "../../../storage";
import { runInTransaction } from "../../../storage/transaction-context";
import type { DenormPlugin } from "./types";

/**
 * Apply a freshly computed denorm payload for one entity — the single place
 * that marks a denorm row `ok`.
 *
 * In one transaction it conditionally marks the entity's `denorm` status row
 * `ok` (computedAt = now, staleAt cleared), then calls the plugin's payload-only
 * `write` with the resolved row id. The status row must exist first because the
 * payload rows reference `denorm.id` via FK, so doing both in one transaction
 * keeps status and payload consistent.
 *
 * Both the event path (registry) and the recompute job route through here, so
 * status ownership lives in exactly one place.
 */
export async function applyComputed<TPayload>(
  plugin: DenormPlugin<TPayload>,
  configId: string,
  entityId: string,
  payload: TPayload,
  generation: number,
  claimToken: string,
): Promise<boolean> {
  return runInTransaction(async () => {
    const row = await storage.denorm.markComputedIfGeneration({
      entityId,
      entityType: plugin.entityType,
      configId,
      computedAt: new Date(),
    }, generation, claimToken);
    // A newer invalidation arrived after compute. Its stale generation remains
    // queued, and writing this older payload would make the status/payload lie.
    if (!row) return false;
    await plugin.write(entityId, payload, row.id);
    return true;
  });
}
