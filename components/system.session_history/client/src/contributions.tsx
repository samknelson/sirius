import { lazy } from "react";
import { componentTabRoute } from "../../../../client/src/lib/component-routes";
import type { ComponentBrowserContributions } from "../../../../client/src/lib/component-contributions";

export const contributions: ComponentBrowserContributions = {
  routes: [{
    path: "/users/:id/session_history",
    layout: "bare",
    page: componentTabRoute(lazy(() => import("./pages/admin/user-session-history")), "session_history", "user"),
  }],
};
