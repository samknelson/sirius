import { lazy } from "react";
import { Calendar } from "lucide-react";
import { componentTabRoute, componentConfigRoute } from "../../../../client/src/lib/component-routes";
import type { ComponentBrowserContributions } from "../../../../client/src/lib/component-contributions";
import { EbaJobSettings, EbaJobSummary } from "./job-ui";
export const contributions: ComponentBrowserContributions = {
  dispatchUi: [{ component: "dispatch.eba", jobSettings: EbaJobSettings, jobSummary: EbaJobSummary }],
  routes: [
    { path: "/workers/:id/dispatch/eba", layout: "bare", page: componentTabRoute(lazy(() => import("./pages/workers/dispatch-eba")), "dispatch-eba", "worker") },
    { path: "/config/dispatch/eba", layout: "bare", page: componentConfigRoute(lazy(() => import("./pages/config/dispatch-eba-settings")), "dispatch.eba") },
  ],
  navigation: [{ section: "dispatch", before: "/config/dispatch/seniority-reset", item: { path: "/config/dispatch/eba", label: "EBA", icon: Calendar, testId: "nav-config-dispatch-eba", permission: "admin", requiresComponent: "dispatch.eba" } }],
};
