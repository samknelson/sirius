import { lazy } from "react";
import type { ComponentBrowserContributions } from "../../../../client/src/lib/component-contributions";
import { componentTabRoute } from "../../../../client/src/lib/component-routes";
export const contributions: ComponentBrowserContributions = {
  slots: [{ slot: "trust.election.relationships", component: "worker.relations",
    section: lazy(() => import("./components/ElectionRelationships")) }],
  routes: [{ path: "/workers/:id/relations", layout: "bare", page: componentTabRoute(lazy(() => import("./pages/workers/relations")), "relations", "worker") }],
};
