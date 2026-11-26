import { lazy } from "react";
import type { ComponentBrowserContributions } from "../../../../client/src/lib/component-contributions";
import { componentTabRoute } from "../../../../client/src/lib/component-routes";
export const contributions: ComponentBrowserContributions = {
  dispatchUi: [{ component: "worker.skills",
    jobForm: lazy(() => import("./dispatch-ui").then(m => ({ default: m.RequiredSkillsForm }))),
    jobDetail: lazy(() => import("./dispatch-ui").then(m => ({ default: m.RequiredSkillsDetails }))),
  }],
  routes: [{ path: "/workers/:id/skills", layout: "bare", page: componentTabRoute(lazy(() => import("./pages/worker-skills")), "skills", "worker") }],
};
