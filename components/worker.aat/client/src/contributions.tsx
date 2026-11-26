import { lazy } from "react";
import type { ComponentBrowserContributions } from "../../../../client/src/lib/component-contributions";
import { componentTabRoute } from "../../../../client/src/lib/component-routes";
export const contributions: ComponentBrowserContributions = {
  routes: [
    { path: "/workers/:id/aat", layout: "bare", page: componentTabRoute(lazy(() => import("./pages/worker-aat")), "aat", "worker") },
    { path: "/edls-sched/:id", layout: "bare", page: lazy(() => import("./schedule-route")) },
  ],
  slots: [{ slot: "worker.edls.schedule", component: "worker.aat", section: lazy(() => import("./components/WorkerEdlsScheduleCard").then(m => ({ default: m.WorkerEdlsScheduleCard }))) }],
};
