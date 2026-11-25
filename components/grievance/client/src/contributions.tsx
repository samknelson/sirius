import { lazy, type ComponentType } from "react";
import { FileText, List } from "lucide-react";
import type { ComponentBrowserContributions } from "../../../../client/src/lib/component-contributions";

const route = (name: string) => lazy(() => import("./routes").then(m => ({ default: (m as Record<string, ComponentType>)[name] })));

export const contributions: ComponentBrowserContributions = {
  routes: [
    { path: "/grievances/add", layout: "bare", page: route("GrievancesAddRoute") },
    { path: "/grievances", layout: "bare", page: route("GrievancesRoute") },
    { path: "/grievance/:id/edit", layout: "bare", page: route("GrievanceEditRoute") },
    { path: "/grievance/:id/status-history", layout: "bare", page: route("GrievanceStatusHistoryRoute") },
    { path: "/grievance/:id/logs", layout: "bare", page: route("GrievanceLogsRoute") },
    { path: "/grievance/:id/notes", layout: "bare", page: route("GrievanceNotesRoute") },
    { path: "/grievance/:id/timeline", layout: "bare", page: route("GrievanceTimelineRoute") },
    { path: "/grievance/:id/files", layout: "bare", page: route("GrievanceFilesRoute") },
    { path: "/grievance/:id", layout: "bare", page: route("GrievanceViewRoute") },
    { path: "/grievance-timeline-templates", layout: "bare", page: route("GrievanceTimelineTemplatesRoute") },
    { path: "/grievance-timeline-template/:id/edit", layout: "bare", page: route("GrievanceTimelineTemplateEditRoute") },
    { path: "/grievance-timeline-template/:id/items", layout: "bare", page: route("GrievanceTimelineTemplateItemsRoute") },
    { path: "/grievance-timeline-template/:id/logs", layout: "bare", page: route("GrievanceTimelineTemplateLogsRoute") },
    { path: "/grievance-timeline-template/:id", layout: "bare", page: route("GrievanceTimelineTemplateViewRoute") },
    { path: "/workers/:id/grievances", layout: "bare", page: route("WorkerGrievancesRoute") },
    { path: "/employers/:id/grievances", layout: "bare", page: route("EmployerGrievancesRoute") },
  ],
  configSections: [{
    id: "grievance",
    title: "Grievance",
    description: "Grievance tracking configuration",
    icon: FileText,
    items: [
      { path: "/grievance-timeline-templates", label: "Timeline Templates", icon: List, testId: "nav-config-grievance-timeline-templates", permission: "admin", requiresComponent: "grievance" },
    ],
  }],
};
