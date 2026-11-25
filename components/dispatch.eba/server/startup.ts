import type { ComponentStartup } from "../../../server/services/component/startup-types";
import { registerVariableEntry } from "../../../server/modules/system/variable-registry";
import { dispatchEbaSettingsSchema } from "./modules/dispatch/eba-config";
import { registerWorkerDispatchEbaRoutes } from "./modules/dispatch/worker-eba";
export function register(): void {
  registerVariableEntry("dispatch_eba_settings", { readTier: "authenticated", component: "dispatch", schema: dispatchEbaSettingsSchema });
}
export const registerRoutes: NonNullable<ComponentStartup["registerRoutes"]> = (app, auth, _permission, access) => {
  registerWorkerDispatchEbaRoutes(app, auth, access);
};
