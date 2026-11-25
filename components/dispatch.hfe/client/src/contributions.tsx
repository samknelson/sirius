import { lazy } from "react";
import { componentTabRoute } from "../../../../client/src/lib/component-routes";
import type { ComponentBrowserContributions } from "../../../../client/src/lib/component-contributions";
export const contributions: ComponentBrowserContributions = {
  routes: [{ path: "/workers/:id/dispatch/hold-for-employer", layout: "bare", page: componentTabRoute(lazy(() => import("./pages/workers/dispatch-hold-for-employer")), "dispatch-hfe", "worker") }],
};
