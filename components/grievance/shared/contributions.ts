import type { ComponentContributions } from "../../../shared/component-contributions";
import type { HierarchicalTab } from "../../../shared/tabRegistry";

declare module "../../../shared/tabRegistry" {
  interface TabEntityTypes {
    grievance: true;
    grievanceTimelineTemplate: true;
  }
}

const grievanceTabs: HierarchicalTab[] = [
  { id: 'details', label: 'Details', hrefTemplate: '/grievance/{id}', permission: 'staff', component: 'grievance' },
  { id: 'edit', label: 'Edit', hrefTemplate: '/grievance/{id}/edit', permission: 'staff', component: 'grievance' },
  {
    id: 'timeline', label: 'Timeline', hrefTemplate: '/grievance/{id}/timeline', permission: 'staff', component: 'grievance',
    children: [
      { id: 'timeline-view', label: 'View', hrefTemplate: '/grievance/{id}/timeline', permission: 'staff', component: 'grievance' },
      { id: 'status-history', label: 'Edit', hrefTemplate: '/grievance/{id}/status-history', permission: 'staff', component: 'grievance' },
    ],
  },
  { id: 'files', label: 'Files', hrefTemplate: '/grievance/{id}/files', permission: 'staff', component: 'grievance', entityContext: { framework: 'entity-files', contextId: 'grievance' } },
  { id: 'notes', label: 'Notes', hrefTemplate: '/grievance/{id}/notes', permission: 'staff', component: 'grievance', entityContext: { framework: 'entity-notes', contextId: 'grievance' } },
  { id: 'logs', label: 'Logs', hrefTemplate: '/grievance/{id}/logs', permission: 'staff', component: 'grievance' },
];

const timelineTemplateTabs: HierarchicalTab[] = [
  { id: 'details', label: 'Details', hrefTemplate: '/grievance-timeline-template/{id}', permission: 'admin', component: 'grievance' },
  { id: 'edit', label: 'Edit', hrefTemplate: '/grievance-timeline-template/{id}/edit', permission: 'admin', component: 'grievance' },
  { id: 'items', label: 'Steps', hrefTemplate: '/grievance-timeline-template/{id}/items', permission: 'admin', component: 'grievance' },
  { id: 'logs', label: 'Logs', hrefTemplate: '/grievance-timeline-template/{id}/logs', permission: 'admin', component: 'grievance' },
];

export const contributions: ComponentContributions = {
  tabs: [
    ...grievanceTabs.map(tab => ({ entity: "grievance" as const, tab })),
    ...timelineTemplateTabs.map(tab => ({ entity: "grievanceTimelineTemplate" as const, tab })),
    { entity: "worker", before: "notes", tab: { id: 'grievances', label: 'Grievances', hrefTemplate: '/workers/{id}/grievances', permission: 'staff', component: 'grievance' } },
    { entity: "employer", before: "school-attributes", tab: { id: 'grievances', label: 'Grievances', hrefTemplate: '/employers/{id}/grievances', permission: 'staff', component: 'grievance' } },
  ],
  menu: [{ before: "users", node: {
    id: "grievances",
    label: "Grievances",
    icon: "FileText",
    href: "/grievances",
    active: { type: "prefix", value: "/grievance" },
    testId: "nav-grievances-top",
    gate: { allOf: [{ component: "grievance" }, { policy: "staff" }] },
  } }],
};
