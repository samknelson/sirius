import { withStorageLogging } from "../../../server/storage/middleware/logging";
import { createDispatchJobForeStorage, dispatchJobForeLoggingConfig } from "./storage/dispatch/fore";
export function createStorage(): { dispatchJobFore: ReturnType<typeof createDispatchJobForeStorage> } {
  return { dispatchJobFore: withStorageLogging(createDispatchJobForeStorage(), dispatchJobForeLoggingConfig) };
}
