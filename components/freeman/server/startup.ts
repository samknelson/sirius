import type { PackageStartup } from "../../../server/services/component-package-types";
import { registerFreemanSecondShiftRoutes } from "./modules/sitespecific/freeman/second-shift";
import { registerFreemanCrewleadsRoutes } from "./modules/sitespecific/freeman/crewleads";
import { registerFreemanEdlsMigrateRoutes } from "./modules/sitespecific/freeman/edls-migrate/routes";
import { initializeFreemanMigrateRecovery } from "./modules/sitespecific/freeman/edls-migrate/recovery";

export const registerRoutes: NonNullable<PackageStartup["registerRoutes"]> = (app, auth, permission, access) => {
  registerFreemanSecondShiftRoutes(app, auth, access);
  registerFreemanCrewleadsRoutes(app, auth, permission, access);
  registerFreemanEdlsMigrateRoutes(app, auth, permission);
};

export const start: NonNullable<PackageStartup["start"]> = async ({ roles }) => {
  if (roles.has("api-user")) await initializeFreemanMigrateRecovery();
};
