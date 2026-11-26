import { withStorageLogging } from "../../../server/storage/middleware/logging";
import { createWorkerSkillStorage, workerSkillLoggingConfig, type WorkerSkillStorage } from "./storage/workers/skills";
export function createStorage(): { workerSkills: WorkerSkillStorage } {
  return { workerSkills: withStorageLogging(createWorkerSkillStorage(), workerSkillLoggingConfig) };
}
