import { withStorageLogging } from "../../../server/storage/middleware/logging";
import { createFreemanCrewleadsStorage, freemanCrewleadsLoggingConfig } from "./storage/sitespecific/freeman/crewleads";

export function createStorage() {
  return {
    freemanCrewleads: withStorageLogging(createFreemanCrewleadsStorage(), freemanCrewleadsLoggingConfig),
  };
}
