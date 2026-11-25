import { lazy } from "react";
import type { ComponentBrowserContributions } from "../../../../client/src/lib/component-contributions";

export const contributions: ComponentBrowserContributions = {
  routes: [
    { path: "/admin/ws/clients/:id/freeman-bearer-authorization", page: lazy(() => import("./routes").then(m => ({default: m.BearerRoute}))) },
  ],
};
