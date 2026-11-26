import type { ComponentStartup } from "../../../server/services/component/startup-types";
import "./options";
import "./plugins/trust/eligibility/plugins/relationshipType";
import { registerTrustRelationships } from "./trust-relationships";
export const register = registerTrustRelationships;
import { registerWorkerRelationsRoutes } from "./modules/workers/relations";
export const registerRoutes: NonNullable<ComponentStartup["registerRoutes"]> =
  (app, auth, _permission, access) => registerWorkerRelationsRoutes(app, auth, access);
