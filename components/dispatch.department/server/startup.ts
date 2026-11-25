import type { ComponentStartup } from "../../../server/services/component/startup-types";
import { registerWorkerDispatchDepartmentRoutes } from "./modules/dispatch/worker-departments";
export const registerRoutes: NonNullable<ComponentStartup["registerRoutes"]> = app => registerWorkerDispatchDepartmentRoutes(app);
