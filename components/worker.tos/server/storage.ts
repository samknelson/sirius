import { withStorageLogging } from "../../../server/storage/middleware/logging";
import { createWorkerTosStorage, workerTosLoggingConfig, type WorkerTosStorage } from "./storage/workers/tos";
export function createStorage(): { workerTos: WorkerTosStorage } {
  return { workerTos: withStorageLogging(createWorkerTosStorage(), workerTosLoggingConfig) };
}
