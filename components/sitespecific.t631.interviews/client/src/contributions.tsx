import { lazy } from "react";
import type { ComponentBrowserContributions } from "../../../../client/src/lib/component-contributions";
export const contributions: ComponentBrowserContributions = {
  routes: [
    { path: "/workers/:id/dispatch/sitespecific_t631_interviews", layout: "bare", page: lazy(() => import("./routes").then(m => ({ default: m.WorkerInterviewsRoute }))) },
    { path: "/dispatch/job/:id/sitespecific_t631_interviews", layout: "bare", page: lazy(() => import("./routes").then(m => ({ default: m.JobInterviewsRoute }))) },
    { path: "/dispatch/job/:id/sitespecific_t631_interviews/offers", layout: "bare", page: lazy(() => import("./routes").then(m => ({ default: m.JobOffersRoute }))) },
  ],
};
