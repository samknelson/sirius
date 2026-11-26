import { lazy } from "react";
import { Calendar } from "lucide-react";
import type { ComponentBrowserContributions } from "../../../../client/src/lib/component-contributions";
import { componentTabRoute, componentConfigRoute } from "../../../../client/src/lib/component-routes";
export const contributions: ComponentBrowserContributions = {
  routes: [
    { path: "/workers/:id/employment/tos", layout: "bare", page: componentTabRoute(lazy(() => import("./pages/worker-tos")), "tos", "worker") },
    { path: "/config/workers/tos", layout: "bare", page: componentConfigRoute(lazy(() => import("./pages/config/config-workers-tos")), "worker.tos") },
    { path: "/edls/tos", layout: "bare", page: lazy(() => import("./edls-route")) },
  ],
  navigation: [{ section: "workers", item: { path: "/config/workers/tos", label: "Time Off Sick", icon: Calendar, testId: "nav-config-workers-tos", permission: "admin", requiresComponent: "worker.tos" } }],
  slots: [{ slot: "worker.banner", component: "worker.tos", section: lazy(() => import("./components/WorkerTosBanner")) }],
};
