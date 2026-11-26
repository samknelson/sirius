import { lazy } from "react";
import type { ComponentBrowserContributions } from "../../../../client/src/lib/component-contributions";
import { componentTabRoute } from "../../../../client/src/lib/component-routes";
export const contributions: ComponentBrowserContributions = {
  routes: [{ path: "/workers/:id/badges", layout: "bare", page: componentTabRoute(lazy(() => import("./pages/workers/badges")), "badges", "worker") }],
};
