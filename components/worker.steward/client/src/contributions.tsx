import { lazy } from "react";
import { Users } from "lucide-react";
import type { ComponentBrowserContributions } from "../../../../client/src/lib/component-contributions";
import { componentTabRoute, componentConfigRoute } from "../../../../client/src/lib/component-routes";
export const contributions: ComponentBrowserContributions = {
  routes: [
    { path: "/workers/:id/union/steward", layout: "bare", page: componentTabRoute(lazy(() => import("./pages/worker-steward")), "steward", "worker") },
    { path: "/employers/:id/union/stewards", layout: "bare", page: componentTabRoute(lazy(() => import("./pages/employer-stewards")), "stewards", "employer") },
    { path: "/config/steward-settings", layout: "bare", page: componentConfigRoute(lazy(() => import("./pages/config/steward-settings")), "worker.steward") },
    { path: "/stewards", layout: "bare", page: lazy(() => import("./stewards-route")) },
  ],
  navigation: [{ section: "workers", before: "/config/workers/ban", item: { path: "/config/steward-settings", label: "Steward", icon: Users, testId: "nav-config-steward-settings", permission: "admin", requiresComponent: "worker.steward" } }],
  pluginViews: { dashboard: {
    "my-steward:MySteward": lazy(() => import("./plugins/dashboard/my-steward/MySteward").then(m => ({ default: m.MySteward }))),
  }, wizardSteps: {
    "btu_building_rep_import:RunView": lazy(() => import("./plugins/wizards/btu_building_rep_import/RunView").then(m => ({ default: m.RunView }))),
    "btu_building_rep_import:BuildingRepUpload": lazy(() => import("./plugins/wizards/btu_building_rep_import/BuildingRepUpload").then(m => ({ default: m.BuildingRepUpload }))),
    "btu_building_rep_import:BuildingRepPreview": lazy(() => import("./plugins/wizards/btu_building_rep_import/BuildingRepPreview").then(m => ({ default: m.BuildingRepPreview }))),
    "btu_building_rep_import:BuildingRepResults": lazy(() => import("./plugins/wizards/btu_building_rep_import/BuildingRepResults").then(m => ({ default: m.BuildingRepResults }))),
  } },
};
