import type { ComponentStartup } from "../../../server/services/component/startup-types";
import { storage } from "../../../server/storage";
import { initializeSessionHistoryListener } from "./services/session-history";
import { registerSessionHistoryRoutes } from "./modules/session-history";

export function register(): void {
  // Unconditional, before hook closure and before any authentication requests.
  // Registration reads no tables; runtime availability is checked by the framework.
  initializeSessionHistoryListener(storage.sessionHistory);
}

export const registerRoutes: NonNullable<ComponentStartup["registerRoutes"]> = (app) => {
  registerSessionHistoryRoutes(app);
};
