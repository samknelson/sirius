import { withStorageLogging } from "../../../server/storage/middleware/logging";
import { createWorkerRatingStorage, workerRatingLoggingConfig, type WorkerRatingStorage } from "./storage/workers/ratings";
export function createStorage(): { workerRatings: WorkerRatingStorage } {
  return { workerRatings: withStorageLogging(createWorkerRatingStorage(), workerRatingLoggingConfig) };
}
