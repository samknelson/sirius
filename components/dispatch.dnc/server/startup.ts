import type { ComponentStartup } from "../../../server/services/component-startup-types";
import "../shared/access-policies/worker/dispatch/dnc/view";
import "../shared/access-policies/worker/dispatch/dnc/edit";
import { registerVariableEntry } from "../../../server/modules/system/variable-registry";
import { dispatchDncNotificationConfigSchema } from "./modules/dispatch/dnc-config";
import { registerWorkerDispatchDncRoutes } from "./modules/dispatch/worker-dnc";
import { registerEntityLoader } from "../../../server/services/access-policy-evaluator";
export function register(): void {
  registerEntityLoader("worker.dispatch.dnc", async (id, storage) => (await storage.workerDispatchDnc.get(id)) ?? null);
  registerVariableEntry("dispatch_dnc_notifications", { component: "dispatch", schema: dispatchDncNotificationConfigSchema });
}
export const registerRoutes: NonNullable<ComponentStartup["registerRoutes"]> = (app, auth, _permission, access) => {
  registerWorkerDispatchDncRoutes(app, auth, access);
};
