import { withStorageLogging } from "../../../server/storage/middleware/logging";
import { createEdlsSheetsStorage, edlsSheetsLoggingConfig } from "./storage/edls/sheets";
import { createEdlsCrewsStorage, edlsCrewsLoggingConfig } from "./storage/edls/crews";
import { createEdlsAssignmentsStorage, edlsAssignmentsLoggingConfig } from "./storage/edls/assignments";
import { createWorkerEdlsStorage, workerEdlsLoggingConfig } from "./storage/edls/workers";
import { createEdlsWorkerDirectoryStorage } from "./storage/edls/worker-directory";

export function createStorage() {
  return {
    edlsSheets: withStorageLogging(createEdlsSheetsStorage(), edlsSheetsLoggingConfig),
    edlsCrews: withStorageLogging(createEdlsCrewsStorage(), edlsCrewsLoggingConfig),
    edlsAssignments: withStorageLogging(createEdlsAssignmentsStorage(), edlsAssignmentsLoggingConfig),
    workerEdls: withStorageLogging(createWorkerEdlsStorage(), workerEdlsLoggingConfig),
    edlsWorkerDirectory: createEdlsWorkerDirectoryStorage(),
  };
}
