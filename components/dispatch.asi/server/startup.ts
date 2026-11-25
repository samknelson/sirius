import type { ComponentStartup } from "../../../server/services/component/startup-types";
import "../shared/access-policies/worker/dispatch/asi";
import { registerWorkerDispatchAsiRoutes } from "./modules/dispatch/worker-asi";
export const registerRoutes: NonNullable<ComponentStartup["registerRoutes"]> = (app, auth, _permission, access) => {
  registerWorkerDispatchAsiRoutes(app, auth, access);
};
