import { lazy } from "react";
import type { ComponentBrowserContributions } from "../../../../client/src/lib/component-contributions";
import { CrewLeadEditor, CrewLeadDetail } from "./crew-lead-ui";

// Navigation imports this module too. Keep layouts and route guards lazy to
// avoid importing navigation again before the contribution list is initialized.
export const contributions: ComponentBrowserContributions = {
  routes: [
    { path: "/workers/:id/sitespecific-freeman-2shift", page: lazy(() => import("./routes").then(m => ({default: m.SecondShiftRoute}))) },
    { path: "/edls/freeman/crewleads", page: lazy(() => import("./routes").then(m => ({default: m.CrewLeadsRoute}))) },
    { path: "/static/sitespecific/freeman/changelog", page: lazy(() => import("./routes").then(m => ({default: m.ChangelogRoute}))) },
  ],
  slots: [
    { slot: "edls.crew.editor", component: "sitespecific.freeman", section: CrewLeadEditor },
    { slot: "edls.crew.detail", component: "sitespecific.freeman", section: CrewLeadDetail },
  ],
};
