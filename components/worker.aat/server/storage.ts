import { withStorageLogging } from "../../../server/storage/middleware/logging";
import { createWorkerAatStorage, workerAatLoggingConfig, type WorkerAatStorage } from "./storage/workers/aat";
export function createStorage(): { workerAat: WorkerAatStorage } {
  return { workerAat: withStorageLogging(createWorkerAatStorage(), workerAatLoggingConfig) };
}
