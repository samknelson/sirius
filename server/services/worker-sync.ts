import { isComponentEnabled } from "../modules/components";
import type { WorkerEinSyncResult, SyncUnit } from "./worker-sync-types";
import { SyncRunRefusal } from "./worker-sync-types";
export { SyncInterrupted, SyncRunRefusal } from "./worker-sync-types";
export type { WorkerEinSyncResult, SyncUnit } from "./worker-sync-types";

type Strategy = {
  component: string;
  /** The provider validates its own wire format before doing any work. */
  run: (response: unknown, dryRun: boolean, unit?: SyncUnit) => Promise<WorkerEinSyncResult>;
};
let strategy: Strategy | undefined;
export function registerWorkerSyncStrategy(value: Strategy): void {
  if (strategy) throw new Error("A worker sync identity strategy is already registered");
  strategy = value;
}
export async function syncWorkerEins(response: unknown, dryRun: boolean, unit?: SyncUnit) {
  if (!strategy || !(await isComponentEnabled(strategy.component))) {
    throw new SyncRunRefusal("The worker identity synchronization provider is unavailable; no workers were changed.");
  }
  return strategy.run(response, dryRun, unit);
}
