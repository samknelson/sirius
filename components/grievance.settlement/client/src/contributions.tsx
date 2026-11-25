import { lazy } from "react";
import type { ComponentBrowserContributions } from "../../../../client/src/lib/component-contributions";

export const contributions: ComponentBrowserContributions = {
  routes: [
    { path: "/grievance/:id/settlements", layout: "bare", page: lazy(() => import("./routes").then(m => ({ default: m.GrievanceSettlementsRoute }))) },
  ],
};
