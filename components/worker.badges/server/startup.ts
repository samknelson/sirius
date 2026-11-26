import type { ComponentStartup } from "../../../server/services/component/startup-types";
import "./options";
import { registerWorkerBadgesRoutes } from "./modules/workers/badges";
import "./plugins/system/denorm/plugins/workerBadgeFromNote";
export const registerRoutes: NonNullable<ComponentStartup["registerRoutes"]> =
  (app, auth) => registerWorkerBadgesRoutes(app, auth);
