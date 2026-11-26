import { lazy } from "react";
import type { ComponentBrowserContributions } from "../../../../client/src/lib/component-contributions";
import { componentTabRoute } from "../../../../client/src/lib/component-routes";
const View = lazy(() => import("./pages/worker-certification-view"));
const Edit = () => <View defaultTab="edit" />;
export const contributions: ComponentBrowserContributions = {
  routes: [
    { path: "/workers/:id/certifications", layout: "bare", page: componentTabRoute(lazy(() => import("./pages/worker-certifications")), "certifications", "worker") },
    { path: "/worker-certification/:id", layout: "bare", page: componentTabRoute(View, "view", "worker_certification") },
    { path: "/worker-certification/:id/edit", layout: "bare", page: componentTabRoute(Edit, "edit", "worker_certification") },
  ],
};
