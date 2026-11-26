import type { ComponentStartup } from "../../../server/services/component/startup-types";
import { registerWorkerAatRoutes } from "./modules/workers/aat";
import { registerEdlsPublicScheduleRoutes } from "./modules/edls/public-schedule";
import "./plugins/event-notifier/plugins/edls-sheet-worker-sms-notifier";
export const registerRoutes: NonNullable<ComponentStartup["registerRoutes"]> =
  (app, auth, _permission, access) => {
    registerWorkerAatRoutes(app, auth, access);
    registerEdlsPublicScheduleRoutes(app);
  };
