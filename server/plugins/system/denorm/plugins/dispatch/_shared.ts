import { storage } from "../../../../../storage";

/**
 * Shared contract for the dispatch-eligibility denorm plugins.
 *
 * Each eligibility concept (ban, dnc, skill, …) is its own denorm plugin that
 * owns a slice of the `worker_dispatch_elig_denorm` EAV table for one worker.
 * Every plugin's `compute` returns the full set of `{ workerId, category,
 * value }` facts for that worker/concept, and the denorm wrapper persists them
 * via the shared `write` below (replace-by-`denorm_id`).
 *
 * The read side (the eligibility query conditions in
 * `server/plugins/dispatch/eligibility/*`) consumes the same `category`/`value`
 * facts; the category names are the single point of coupling between the write
 * (denorm) and read (dispatch) sides.
 */
export interface DispatchEligEntry {
  workerId: string;
  category: string;
  value: string;
}

export interface DispatchEligDenormPayload {
  entries: DispatchEligEntry[];
}

/**
 * Backfill source shared by every dispatch-eligibility denorm plugin: every
 * worker should have a denorm row for the plugin's config, so return those that
 * don't yet (read-only anti-join). The registry enqueues them as `stale`, and
 * the recompute sweep fills the payload (possibly empty) via `compute`.
 */
export function dispatchEligBackfill(configId: string, limit: number): Promise<string[]> {
  return storage.workers.findIdsMissingDenorm(configId, limit);
}

/**
 * Widow source shared by every dispatch-eligibility denorm plugin: denorm rows
 * whose worker no longer exists (read-only anti-join). The wrapper deletes them;
 * the dependent `worker_dispatch_elig_denorm` rows cascade away via the FK.
 */
export function dispatchEligFindWidows(configId: string, limit: number): Promise<string[]> {
  return storage.workers.findDenormWidowIds(configId, limit);
}

/**
 * Payload-only write shared by every dispatch-eligibility denorm plugin. The
 * wrapper (`applyComputed`) has already upserted the `denorm` status row to `ok`
 * and supplies its id; we only replace this concept's eligibility rows scoped to
 * that denorm row.
 */
export async function writeDispatchElig(
  _workerId: string,
  payload: DispatchEligDenormPayload,
  denormRowId: string,
): Promise<void> {
  await storage.workerDispatchEligDenorm.replaceForDenorm(denormRowId, payload.entries);
}
