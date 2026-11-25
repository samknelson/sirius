import { withStorageLogging } from "../../../server/storage/middleware/logging";
import { createT631InterviewsStorage, t631InterviewsLoggingConfig } from "./storage/sitespecific/t631/interviews";
export function createStorage() {
  return { t631Interviews: withStorageLogging(createT631InterviewsStorage(), t631InterviewsLoggingConfig) };
}
