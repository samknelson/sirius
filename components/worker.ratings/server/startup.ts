import type { ComponentStartup } from "../../../server/services/component/startup-types";
import "./options";
import { registerWorkerRatingsRoutes } from "./modules/workers/ratings";
import "./plugins/wizards/plugins/worker-ratings-import";
import { registerEdlsRatingQueryPlan } from "./storage/edls-query-plan";
export const register = registerEdlsRatingQueryPlan;
export const registerRoutes: NonNullable<ComponentStartup["registerRoutes"]> =
  (app, auth, permission, access) => registerWorkerRatingsRoutes(app, auth, access, permission);
