import { lazy } from "react";
import { List } from "lucide-react";
import type { ComponentBrowserContributions } from "../../../../client/src/lib/component-contributions";
export const contributions: ComponentBrowserContributions = {
  routes: [
    { path: "/sitespecific/t631/arrive", layout: "bare", page: lazy(() => import("./routes").then(m => ({ default: m.ArrivalRoute }))) },
    { path: "/config/edls/t631-ms", layout: "bare", page: lazy(() => import("./routes").then(m => ({ default: m.MemberStatusRoute }))) },
  ],
  navigation: [{ section: "edls", item: {
    path: "/config/edls/t631-ms", label: "Teamsters 631 MS", icon: List,
    testId: "nav-config-edls-t631-ms", permission: "admin",
    requiresComponents: ["edls", "sitespecific.t631.client"],
  } }],
};
