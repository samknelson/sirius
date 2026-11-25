import { lazy } from "react";
import { Server } from "lucide-react";
import type { ComponentBrowserContributions } from "../../../../client/src/lib/component-contributions";

// Navigation imports this module too. Keep layouts and route guards lazy to
// avoid importing navigation again before the contribution list is initialized.
export const contributions: ComponentBrowserContributions = {
  routes: [
    { path: "/admin/sitespecific/freeman/edls/migrate", page: lazy(() => import("./routes").then(m => ({default: m.MigrationRoute}))) },
  ],
  navigation: [{ section: "edls", item: { path: "/admin/sitespecific/freeman/edls/migrate", label: "Freeman Migration", icon: Server, testId: "nav-config-edls-freeman-migrate", permission: "admin", requiresComponents: ["edls", "sitespecific.freeman", "sitespecific.freeman.edls_migrate"] } }],
};
