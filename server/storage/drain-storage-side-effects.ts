import { flushPendingLogWrites } from "../services/logs-transport";
import { flushDeferredStorageWork } from "./middleware/logging";

/**
 * Standalone scripts must drain deferred provenance and audit work before
 * closing their database pool. The web process never closes its pool during
 * normal operation, so this lifecycle boundary belongs to script shutdown.
 */
export async function drainStorageSideEffects(): Promise<void> {
  await flushDeferredStorageWork();
  await flushPendingLogWrites();
}