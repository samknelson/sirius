import { createWorkerBadgesDenormStorage, type WorkerBadgesDenormStorage } from "./storage/system/worker-badges-denorm";
export function createStorage(): { workerBadgesDenorm: WorkerBadgesDenormStorage } {
  return { workerBadgesDenorm: createWorkerBadgesDenormStorage() };
}
