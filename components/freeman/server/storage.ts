import { withStorageLogging } from "../../../server/storage/middleware/logging";
import { createFreemanCrewleadsStorage, freemanCrewleadsLoggingConfig } from "./storage/sitespecific/freeman/crewleads";
import { createFreemanEdlsMigrateStagingStorage } from "./storage/sitespecific/freeman/edls-migrate-staging";

export function createStorage() {
  return {
    freemanCrewleads: withStorageLogging(createFreemanCrewleadsStorage(), freemanCrewleadsLoggingConfig),
    // Staging is not record maintenance; keep the existing no-per-row-audit behavior.
    freemanEdlsMigrateStaging: createFreemanEdlsMigrateStagingStorage(),
  };
}
