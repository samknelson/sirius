import type { ComponentStartup } from "../../../server/services/component/startup-types";
import "./options";
import { registerWorkerCertificationsRoutes } from "./modules/workers/certifications";
import "./plugins/system/cron/plugins/workerCertificationActiveScan";
export const registerRoutes: NonNullable<ComponentStartup["registerRoutes"]> =
  (app, auth, permission, access) => registerWorkerCertificationsRoutes(app, auth, access, permission);
