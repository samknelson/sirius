import type { ComponentStartup } from "../../../server/services/component/startup-types";
import { initializeTrustProviderEdiSystem } from "./plugins/trust/provider-edi";
import { registerTrustProviderEdiDashboardRoutes } from "./modules/trust/provider-edi-dashboard";
export const register = initializeTrustProviderEdiSystem;
export const registerRoutes: NonNullable<ComponentStartup["registerRoutes"]> =
  (app, auth) => registerTrustProviderEdiDashboardRoutes(app, auth);
