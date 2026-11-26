import { lazy } from "react";
import type { ComponentBrowserContributions } from "@/lib/component-contributions";

export const contributions: ComponentBrowserContributions = {
  routes: [{ path: "/bookmarks", layout: "bare", page: lazy(() => import("./route")) }],
  slots: [
    { slot: "profile.dropdown.items", component: "bookmark", section: lazy(() => import("./ProfileItem")) },
    { slot: "worker.header.badges", component: "bookmark", section: lazy(() => import("./RecordButtons").then(m => ({ default: m.WorkerButton }))) },
    { slot: "employer.header.badges", component: "bookmark", section: lazy(() => import("./RecordButtons").then(m => ({ default: m.EmployerButton }))) },
    { slot: "company.header.badges", component: "bookmark", section: lazy(() => import("./RecordButtons").then(m => ({ default: m.CompanyButton }))) },
  ],
  pluginViews: { dashboard: {
    "bookmarks:Bookmarks": lazy(() => import("./plugins/dashboard/bookmarks/Bookmarks").then(m => ({ default: m.Bookmarks }))),
  } },
};
