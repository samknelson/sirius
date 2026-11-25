import { lazy } from "react";
import { Server } from "lucide-react";
import type { PackageBrowserContributions } from "../../../../client/src/lib/package-contributions";
import { CrewLeadEditor, CrewLeadDetail } from "./crew-lead-ui";

// Navigation imports this module too. Keep layouts and route guards lazy to
// avoid importing navigation again before the contribution list is initialized.
export const contributions: PackageBrowserContributions = {
  routes: [
    { path: "/workers/:id/sitespecific-freeman-2shift", page: lazy(() => import("./routes").then(m => ({default: m.SecondShiftRoute}))) },
    { path: "/admin/sitespecific/freeman/edls/migrate", page: lazy(() => import("./routes").then(m => ({default: m.MigrationRoute}))) },
    { path: "/admin/ws/clients/:id/freeman-bearer-authorization", page: lazy(() => import("./routes").then(m => ({default: m.BearerRoute}))) },
    { path: "/edls/freeman/crewleads", page: lazy(() => import("./routes").then(m => ({default: m.CrewLeadsRoute}))) },
    { path: "/static/sitespecific/freeman/changelog", page: lazy(() => import("./routes").then(m => ({default: m.ChangelogRoute}))) },
  ],
  navigation: [{ section: "edls", item: { path: "/admin/sitespecific/freeman/edls/migrate", label: "Freeman Migration", icon: Server, testId: "nav-config-edls-freeman-migrate", permission: "admin", requiresComponents: ["edls", "sitespecific.freeman", "sitespecific.freeman.edls_migrate"] } }],
  crewUi: [{ component: "sitespecific.freeman", editor: CrewLeadEditor, detail: CrewLeadDetail }],
};
