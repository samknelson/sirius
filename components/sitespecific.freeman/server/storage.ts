import { withStorageLogging } from "../../../server/storage/middleware/logging";
import { createFreemanCrewleadsStorage, freemanCrewleadsLoggingConfig } from "./storage/sitespecific/freeman/crewleads";
import { createFreemanWorkerIdentityStorage } from "./storage/worker-identities";

export function createStorage() {
  return {
    freemanWorkerIdentities: createFreemanWorkerIdentityStorage(),
    freemanCrewleads: withStorageLogging(createFreemanCrewleadsStorage(), freemanCrewleadsLoggingConfig),
  };
}
