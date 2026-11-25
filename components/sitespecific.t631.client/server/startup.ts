import { z } from "zod";
import type { ComponentStartup } from "../../../server/services/component/startup-types";
import { registerVariableEntry } from "../../../server/modules/system/variable-registry";
import { registerPrivateHttpScope } from "../../../server/services/http-response-privacy";
import { registerT631ClientFetchRoutes } from "./modules/sitespecific/t631/client/fetch";
import { registerT631ArrivalRoutes } from "./modules/sitespecific/t631/arrive";

export function register(): void {
  registerVariableEntry("sitespecific.t631.ms_to_sync", {
    component: "sitespecific.t631.client",
    schema: z.array(z.string()).transform(ids => [...new Set(ids)]),
  });
  registerPrivateHttpScope("/api/public/sitespecific/t631/arrive");
}
export const registerRoutes: NonNullable<ComponentStartup["registerRoutes"]> = (app, auth, permission) => {
  registerT631ClientFetchRoutes(app, auth, permission);
  registerT631ArrivalRoutes(app);
};
