import type { ComponentStartup } from "../../../server/services/component-startup-types";
import { registerGrievanceSettlementRoutes } from "./routes";

export const registerRoutes: NonNullable<ComponentStartup["registerRoutes"]> = (app, auth, _permission, access) => {
  registerGrievanceSettlementRoutes(app, auth, access);
};
