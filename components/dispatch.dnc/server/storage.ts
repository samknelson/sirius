import { withStorageLogging } from "../../../server/storage/middleware/logging";
import { createWorkerDispatchDncStorage, workerDispatchDncLoggingConfig } from "./storage/dispatch/worker-dnc";
export function createStorage(): { workerDispatchDnc: ReturnType<typeof createWorkerDispatchDncStorage> } {
  return { workerDispatchDnc: withStorageLogging(createWorkerDispatchDncStorage(), workerDispatchDncLoggingConfig) };
}
