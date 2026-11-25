import { withStorageLogging } from "../../../server/storage/middleware/logging";
import { createWorkerDispatchDepartmentStorage, workerDispatchDepartmentLoggingConfig } from "./storage/dispatch/worker-departments";
import { createDispatchJobDepartmentStorage } from "./storage/dispatch/job-departments";
export function createStorage(): { workerDispatchDepartments: ReturnType<typeof createWorkerDispatchDepartmentStorage>; dispatchJobDepartments: ReturnType<typeof createDispatchJobDepartmentStorage> } {
  return {
    workerDispatchDepartments: withStorageLogging(createWorkerDispatchDepartmentStorage(), workerDispatchDepartmentLoggingConfig),
    dispatchJobDepartments: createDispatchJobDepartmentStorage(),
  };
}
