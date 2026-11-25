import { isComponentEnabled } from "../../../../modules/components";
import type { WorkerEinSyncResult, T631WorkerListResponse, SyncUnit } from "./sync-contract";
import { SyncRunRefusal } from "./sync-contract";
export { SyncInterrupted, SyncRunRefusal } from "./sync-contract";
export type { WorkerEinSyncResult, SyncUnit } from "./sync-contract";

type Strategy = {
  component: string;
  run: (response: T631WorkerListResponse, dryRun: boolean, unit?: SyncUnit) => Promise<WorkerEinSyncResult>;
};
let strategy: Strategy | undefined;
export function registerWorkerSyncStrategy(value: Strategy): void {
  if (strategy) throw new Error("A worker sync identity strategy is already registered");
  strategy = value;
}
/** No partial sync without identity authority: in particular, never run deactivation. */
export async function syncWorkerEins(response: T631WorkerListResponse, dryRun: boolean, unit?: SyncUnit) {
  if (!strategy || !(await isComponentEnabled(strategy.component))) {
    throw new SyncRunRefusal("The worker identity synchronization provider is unavailable; no workers were changed.");
  }
  return strategy.run(response, dryRun, unit);
}

export { normalizePhoneDigits, parseRemoteWorkerName } from "./worker-values";
