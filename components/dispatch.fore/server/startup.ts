import type { ComponentStartup } from "../../../server/services/component-startup-types";
import "./template-token-migrations";
import { registerDispatchForeRoutes } from "./modules/dispatch/fore";
export const registerRoutes: NonNullable<ComponentStartup["registerRoutes"]> = app => registerDispatchForeRoutes(app);
