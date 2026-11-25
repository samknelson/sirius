import type { ComponentStartup } from "../../../server/services/component-startup-types";
import { registerFreemanEdlsMigrateRoutes } from "./modules/sitespecific/freeman/edls-migrate/routes";
import { initializeFreemanMigrateRecovery } from "./modules/sitespecific/freeman/edls-migrate/recovery";

export const registerRoutes: NonNullable<ComponentStartup["registerRoutes"]> = (app, auth, permission) => {
  registerFreemanEdlsMigrateRoutes(app, auth, permission);
};

export const start: NonNullable<ComponentStartup["start"]> = async ({ roles }) => {
  if (roles.has("api-user")) await initializeFreemanMigrateRecovery();
};
