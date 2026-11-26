import type { ComponentStartup } from "../../../server/services/component/startup-types";
import { z } from "zod";
import { registerVariableEntry } from "../../../server/modules/system/variable-registry";
export function register() {
  registerVariableEntry("worker.tos.absent_banner", {
    readTier: "authenticated", writeTier: "staff", component: "worker.tos", schema: z.string(),
  });
}
import { registerWorkerTosRoutes } from "./modules/workers/tos";
import { registerEdlsTosRoutes } from "./modules/edls/tos";
import "./plugins/event-notifier/plugins/tos-absence-notifier";
import "./plugins/system/denorm/plugins/tosAbsenceReminder";
export const registerRoutes: NonNullable<ComponentStartup["registerRoutes"]> =
  (app, auth, _permission, access) => {
    registerWorkerTosRoutes(app, auth, access);
    registerEdlsTosRoutes(app, auth);
  };
