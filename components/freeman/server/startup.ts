import type { PackageStartup } from "../../../server/services/component-package-types";
import { registerFreemanSecondShiftRoutes } from "./modules/sitespecific/freeman/second-shift";
import { registerFreemanCrewleadsRoutes } from "./modules/sitespecific/freeman/crewleads";
import { registerFreemanEdlsMigrateRoutes } from "./modules/sitespecific/freeman/edls-migrate/routes";
import { initializeFreemanMigrateRecovery } from "./modules/sitespecific/freeman/edls-migrate/recovery";
import { registerWorkerSyncStrategy } from "../../../server/modules/sitespecific/t631/client/sync-workers";
import { syncWorkerEins } from "./modules/t631/sync-workers";
import "./bearer-auth";
import { storage } from "../../../server/storage";
import { runOrDeferStartupOperation } from "../../../server/services/startup-deferrals";

registerWorkerSyncStrategy({ component: "sitespecific.freeman", run: syncWorkerEins });

export const registerRoutes: NonNullable<PackageStartup["registerRoutes"]> = (app, auth, permission, access) => {
  registerFreemanSecondShiftRoutes(app, auth, access);
  registerFreemanCrewleadsRoutes(app, auth, permission, access);
  registerFreemanEdlsMigrateRoutes(app, auth, permission);
};

export const start: NonNullable<PackageStartup["start"]> = async ({ roles }) => {
  // Core client settings only: also upgrade when the optional components are
  // disabled, so later package removal still preserves the authentication choice.
  await runOrDeferStartupOperation("package-bearer-selection-upgrade", async () => {
    for (const client of await storage.wsClients.getAll()) {
      const data = client.data ?? {};
      if (Object.hasOwn(data, "authenticationProvider")) continue;
      const configId = data.freemanBearerAuthorizationConfigId;
      if (typeof configId === "string" && configId.trim()) {
        await storage.wsClients.updateAuthenticationSelection(client.id, data, {
          provider: "freeman-bearer", configId: configId.trim(),
        });
      }
    }
  });
  if (roles.has("api-user")) await initializeFreemanMigrateRecovery();
};
