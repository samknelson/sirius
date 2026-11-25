import type { ComponentStartup } from "../../../server/services/component/startup-types";
import { registerFreemanSecondShiftRoutes } from "./modules/sitespecific/freeman/second-shift";
import { registerFreemanCrewleadsRoutes } from "./modules/sitespecific/freeman/crewleads";
import { registerWorkerSyncStrategy } from "../../../server/services/worker-sync";
import { syncWorkerEins } from "./modules/t631/sync-workers";

registerWorkerSyncStrategy({ component: "sitespecific.freeman", run: syncWorkerEins });

export const registerRoutes: NonNullable<ComponentStartup["registerRoutes"]> = (app, auth, permission, access) => {
  registerFreemanSecondShiftRoutes(app, auth, access);
  registerFreemanCrewleadsRoutes(app, auth, permission, access);
};
