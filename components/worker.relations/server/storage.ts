import { withStorageLogging } from "../../../server/storage/middleware/logging";
import { createWorkerRelationsStorage, workerRelationsLoggingConfig, type WorkerRelationsStorage } from "./storage/workers/relations";
export function createStorage(): { workerRelations: WorkerRelationsStorage } {
  return { workerRelations: withStorageLogging(createWorkerRelationsStorage(), workerRelationsLoggingConfig) };
}
