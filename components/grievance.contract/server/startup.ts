import type { ComponentStartup } from "../../../server/services/component-startup-types";
import { registerGrievanceContractRoutes } from "./routes";

export const registerRoutes: NonNullable<ComponentStartup["registerRoutes"]> = (app, auth, _permission, access) => {
  registerGrievanceContractRoutes(app, auth, access);
};
