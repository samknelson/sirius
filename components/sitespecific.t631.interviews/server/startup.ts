import type { ComponentStartup } from "../../../server/services/component/startup-types";
import { alterHooks } from "../../../shared/alter";
import { tabVisibilityHook } from "../../../shared/tab-visibility";
import { registerT631InterviewsRoutes } from "./modules/sitespecific/t631/interviews";

export function register(): void {
  alterHooks.register(tabVisibilityHook, {
    id: "sitespecific.t631.interviews.worker-tab",
    description: "Hide the worker interviews tab when the worker has no interviews",
    component: "sitespecific.t631.interviews",
    priority: 0,
    metadata: {},
    async alter(visible, context) {
      if (!visible || context.entityType !== "worker" || context.tabId !== "dispatch-t631-interviews") return visible;
      const { storage } = await import("../../../server/storage/database");
      if (!(await storage.t631Interviews.tableExists())) return false;
      return (await storage.t631Interviews.getByWorker(context.entityId)).length > 0;
    },
  });
}
export const registerRoutes: NonNullable<ComponentStartup["registerRoutes"]> = (app, auth, permission, access) => {
  registerT631InterviewsRoutes(app, auth, permission, access);
};
