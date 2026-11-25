import type { ComponentStartup } from "../../../server/services/component/startup-types";
import { registerWorkerDispatchHfeRoutes } from "./modules/dispatch/worker-hfe";
export const registerRoutes: NonNullable<ComponentStartup["registerRoutes"]> = (app, auth, _permission, access) => {
  registerWorkerDispatchHfeRoutes(app, auth, access);
};
