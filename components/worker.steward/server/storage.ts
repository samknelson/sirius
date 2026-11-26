import { withStorageLogging } from "../../../server/storage/middleware/logging";
import { createWorkerStewardAssignmentStorage, workerStewardAssignmentLoggingConfig, type WorkerStewardAssignmentStorage } from "./storage/worker-steward-assignments";
export function createStorage(): { workerStewardAssignments: WorkerStewardAssignmentStorage } {
  return { workerStewardAssignments: withStorageLogging(createWorkerStewardAssignmentStorage(), workerStewardAssignmentLoggingConfig) };
}
