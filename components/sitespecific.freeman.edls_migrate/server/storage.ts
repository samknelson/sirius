import { createFreemanEdlsMigrateStagingStorage } from "./storage/sitespecific/freeman/edls-migrate-staging";

export function createStorage() {
  return {
    // Staging is not record maintenance; keep the existing no-per-row-audit behavior.
    freemanEdlsMigrateStaging: createFreemanEdlsMigrateStagingStorage(),
  };
}
