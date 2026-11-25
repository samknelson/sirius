import { lazy } from "react";
import { componentTabRoute } from "../../../../client/src/lib/component-routes";
import type { ComponentBrowserContributions } from "../../../../client/src/lib/component-contributions";
import { Forepersons, ForepersonJobsSection } from "./job-ui";
export const contributions: ComponentBrowserContributions = {
  dispatchUi: [{ component: "dispatch.fore", jobDetail: Forepersons, workerStatus: ForepersonJobsSection }],
  routes: [{ path: "/dispatch/job/:id/foreperson", layout: "bare", page: componentTabRoute(lazy(() => import("./pages/dispatch/job-fore")), "foreperson", "dispatch_job") }],
};
