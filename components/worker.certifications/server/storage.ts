import { withStorageLogging } from "../../../server/storage/middleware/logging";
import { storage } from "../../../server/storage/database";
import { createWorkerCertificationStorage, workerCertificationLoggingConfig, type WorkerCertificationStorage } from "./storage/workers/certifications";
export function createStorage(): { workerCertifications: WorkerCertificationStorage } {
  // Resolve the already-composed, logged skills storage at invocation, not
  // during DatabaseStorage construction. Never construct a second factory.
  return { workerCertifications: withStorageLogging(createWorkerCertificationStorage({
    get workerSkills() { return storage.workerSkills; },
  }), workerCertificationLoggingConfig) };
}
