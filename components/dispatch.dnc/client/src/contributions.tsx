import { lazy } from "react";
import { Phone } from "lucide-react";
import { componentTabRoute, componentConfigRoute } from "../../../../client/src/lib/component-routes";
import type { ComponentBrowserContributions } from "../../../../client/src/lib/component-contributions";
export const contributions: ComponentBrowserContributions = {
  routes: [
    { path: "/workers/:id/dispatch/do-not-call", layout: "bare", page: componentTabRoute(lazy(() => import("./pages/workers/dispatch-do-not-call")), "dispatch-dnc", "worker") },
    { path: "/config/dispatch/dnc", layout: "bare", page: componentConfigRoute(lazy(() => import("./pages/config/dispatch-dnc")), "dispatch.dnc") },
  ],
  navigation: [{ section: "dispatch", before: "/config/dispatch/seniority-reset", item: { path: "/config/dispatch/dnc", label: "Do Not Call", icon: Phone, testId: "nav-config-dispatch-dnc", permission: "admin", requiresComponent: "dispatch.dnc" } }],
};
