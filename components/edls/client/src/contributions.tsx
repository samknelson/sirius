import { lazy } from "react";
import { Calendar, Settings, List } from "lucide-react";
import type { ComponentBrowserContributions } from "@/lib/component-contributions";

const route = (name: keyof typeof import("./routes")) => lazy(() => import("./routes").then(m => ({ default: m[name] })));
export const contributions: ComponentBrowserContributions = {
  routes: [
    { path: "/edls/sheets", page: route("SheetsRoute"), layout: "bare" },
    { path: "/edls/workers", page: route("WorkersRoute"), layout: "bare" },
    { path: "/edls/assignments", page: route("AssignmentsRoute"), layout: "bare" },
    { path: "/edls/sheet/:id", page: route("DetailsRoute"), layout: "bare" },
    { path: "/edls/sheet/:id/next-assignments", page: route("NextRoute"), layout: "bare" },
    { path: "/edls/sheet/:id/assignments", page: route("AssignRoute"), layout: "bare" },
    { path: "/edls/sheet/:id/manage", page: route("ManageRoute"), layout: "bare" },
    { path: "/edls/sheet/:id/edit", page: route("EditRoute"), layout: "bare" },
    { path: "/edls/sheet/:id/logs", page: route("LogsRoute"), layout: "bare" },
    { path: "/edls/sheet/:id/logs/snapshots", page: route("SnapshotsRoute"), layout: "bare" },
    { path: "/workers/:id/edls", page: route("WorkerStatusRoute"), layout: "bare" },
    { path: "/workers/:id/edls/assignments", page: route("WorkerAssignmentsRoute"), layout: "bare" },
    { path: "/reports/edls", page: route("ReportsRoute"), layout: "bare" },
    { path: "/config/edls/settings", page: route("SettingsRoute"), layout: "bare" },
    { path: "/config/edls/tasks", page: route("TasksRoute"), layout: "bare" },
  ],
  configSections: [{
    id: "edls", title: "EDLS", description: "Employer Day Labor Scheduler configuration", icon: Calendar,
    items: [
      { path: "/config/edls/settings", label: "Settings", icon: Settings, testId: "nav-config-edls-settings", permission: "admin", requiresComponent: "edls" },
      { path: "/config/edls/tasks", label: "", optionsType: "edls-task", icon: List, testId: "nav-config-edls-tasks", permission: "admin", requiresComponent: "edls" },
    ],
  }],
  slots: [{ slot: "worker.header.badges", component: "edls", section: lazy(() => import("./WorkerBadge")) }],
  snapshotRenderers: [{ entityType: "edls_sheet", renderer: lazy(() => import("./SnapshotRenderer")) }],
  pluginViews: {
    dashboard: {
      "edls-summary:EdlsSummary": lazy(() => import("./plugins/dashboard/edls-summary/EdlsSummary").then(m => ({ default: m.EdlsSummary }))),
    },
    wizardSteps: {
      "report_edls_scheduled_too_soon:InputsForm": lazy(() => import("./plugins/wizards/report_edls_scheduled_too_soon/InputsForm").then(m => ({ default: m.InputsForm }))),
      "report_edls_scheduled_too_soon:RunView": lazy(() => import("./plugins/wizards/report_edls_scheduled_too_soon/RunView").then(m => ({ default: m.RunView }))),
      "report_edls_scheduled_too_soon:ResultsTable": lazy(() => import("./plugins/wizards/report_edls_scheduled_too_soon/ResultsTable").then(m => ({ default: m.ResultsTable }))),
      "report_edls_soop:RunView": lazy(() => import("./plugins/wizards/report_edls_soop/RunView").then(m => ({ default: m.RunView }))),
      "report_edls_soop:ResultsTable": lazy(() => import("./plugins/wizards/report_edls_soop/ResultsTable").then(m => ({ default: m.ResultsTable }))),
    },
  },
};
