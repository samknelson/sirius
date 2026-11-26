import { lazy } from "react";
import type { ComponentBrowserContributions } from "../../../../client/src/lib/component-contributions";
import { componentTabRoute } from "../../../../client/src/lib/component-routes";
const WorkerRatings = lazy(() => import("./pages/worker-ratings"));
export const contributions: ComponentBrowserContributions = {
  slots: [
    { slot: "edls.workers.filters", component: "worker.ratings", section: lazy(() => import("./directory-ui").then(m => ({ default: m.DirectoryRatingFilters }))) },
    { slot: "edls.workers.header", component: "worker.ratings", section: lazy(() => import("./directory-ui").then(m => ({ default: m.DirectoryRatingHeader }))) },
    { slot: "edls.workers.cell", component: "worker.ratings", section: lazy(() => import("./directory-ui").then(m => ({ default: m.DirectoryRatingCell }))) },
    { slot: "edls.worker-details", component: "worker.ratings", section: lazy(() => import("./worker-details")) },
    { slot: "edls.assignments.provider", component: "worker.ratings", section: lazy(() => import("./assignment-ui").then(m => ({ default: m.AssignmentRatings }))) },
    { slot: "edls.assignments.filter", component: "worker.ratings", section: lazy(() => import("./assignment-ui").then(m => ({ default: m.AssignmentRatingSelect }))) },
    { slot: "edls.assignments.value", component: "worker.ratings", section: lazy(() => import("./assignment-ui").then(m => ({ default: m.AssignmentRatingValue }))) },
    { slot: "edls.assignments.stats", component: "worker.ratings", section: lazy(() => import("./assignment-ui").then(m => ({ default: m.AssignmentRatingStats }))) },
  ],
  routes: [{ path: "/workers/:id/ratings", layout: "bare", page: componentTabRoute(WorkerRatings, "ratings", "worker") }],
  pluginViews: { wizardSteps: {
    "worker_ratings_import:RunView": lazy(() => import("./plugins/wizards/worker_ratings_import/RunView").then(m => ({ default: m.RunView }))),
    "worker_ratings_import:RatingsConfigure": lazy(() => import("./plugins/wizards/worker_ratings_import/RatingsConfigure").then(m => ({ default: m.RatingsConfigure }))),
    "worker_ratings_import:FeedUpload": lazy(() => import("./plugins/wizards/worker_ratings_import/FeedUpload").then(m => ({ default: m.FeedUpload }))),
    "worker_ratings_import:FeedMap": lazy(() => import("./plugins/wizards/worker_ratings_import/FeedMap").then(m => ({ default: m.FeedMap }))),
    "worker_ratings_import:FeedResults": lazy(() => import("./plugins/wizards/worker_ratings_import/FeedResults").then(m => ({ default: m.FeedResults }))),
  } },
};
