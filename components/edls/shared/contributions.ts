import type { ComponentContributions } from "../../../shared/component-contributions";
import type { HierarchicalTab } from "../../../shared/tabRegistry";

declare module "../../../shared/tabRegistry" {
  interface TabEntityTypes { edls_sheet: true }
}
declare module "../../../shared/accessPolicies" {
  interface ComponentPolicyEntityTypes { edls_sheet: true }
}

export const edlsSheetTabTree: HierarchicalTab[] = [
  { id: "details", label: "Details", hrefTemplate: "/edls/sheet/{id}", policyId: "edls.sheet.view", component: "edls", children: [
    { id: "overview", label: "Overview", hrefTemplate: "/edls/sheet/{id}", policyId: "edls.sheet.view", component: "edls" },
    { id: "next-assignments", label: "Next Assignments", hrefTemplate: "/edls/sheet/{id}/next-assignments", policyId: "edls.sheet.view", component: "edls" },
  ] },
  { id: "edit", label: "Edit", hrefTemplate: "/edls/sheet/{id}/edit", policyId: "edls.sheet.edit", component: "edls" },
  { id: "manage", label: "Manage", hrefTemplate: "/edls/sheet/{id}/manage", policyId: "edls.sheet.manage_view", component: "edls" },
  { id: "assignments", label: "Assign Workers", hrefTemplate: "/edls/sheet/{id}/assignments", policyId: "edls.sheet.assign", component: "edls" },
  { id: "logs", label: "Logs", hrefTemplate: "/edls/sheet/{id}/logs", policyId: "edls.any", component: "edls", children: [
    { id: "activity", label: "Activity", hrefTemplate: "/edls/sheet/{id}/logs", policyId: "edls.any", component: "edls" },
    { id: "snapshots", label: "Snapshots", hrefTemplate: "/edls/sheet/{id}/logs/snapshots", policyId: "edls.sheet.view", component: "edls" },
  ] },
];

export const contributions: ComponentContributions = {
  tabs: [
    { entity: "worker", before: "sitespecific-bao-beneficiaries", tab: {
      id: "edls", label: "EDLS", hrefTemplate: "/workers/{id}/edls", policyId: "edls.coordinator", component: "edls", children: [
        { id: "edls-status", label: "Status", hrefTemplate: "/workers/{id}/edls", policyId: "edls.coordinator", component: "edls" },
        { id: "edls-assignments", label: "Assignments", hrefTemplate: "/workers/{id}/edls/assignments", policyId: "edls.coordinator", component: "edls" },
      ],
    } },
    ...edlsSheetTabTree.map(tab => ({ entity: "edls_sheet" as const, tab })),
  ],
  menu: [{ before: "trust", node: {
    id: "edls", label: "EDLS", icon: "FileSpreadsheet",
    active: { type: "prefix", value: "/edls" }, testId: "nav-edls",
    gate: { allOf: [{ component: "edls" }, { anyOf: [{ policy: "staff" }, { policy: "edls.any" }] }] },
    children: [
      { id: "edls-sheets", label: "Sheets", icon: "FileSpreadsheet", href: "/edls/sheets", testId: "menu-edls-sheets", gate: { policy: "edls.any" }, children: [
        { id: "edls-sheets-list", label: "Sheets", icon: "FileSpreadsheet", href: "/edls/sheets", testId: "menu-edls-sheets-list", gate: { policy: "edls.any" } },
        { id: "edls-assignments", label: "Assignments", icon: "List", href: "/edls/assignments", testId: "menu-edls-assignments", gate: { allOf: [{ component: "edls" }, { policy: "edls.coordinator" }] } },
      ] },
      { id: "edls-workers", label: "Workers", icon: "Users", href: "/edls/workers", testId: "menu-edls-workers", gate: { policy: "edls.any" } },
      { id: "edls-reports", label: "Reports", icon: "FileText", href: "/reports/edls", testId: "menu-edls-reports", gate: { policy: "edls.reader" } },
    ],
  } }],
};
