import type { ComponentContributions } from "../../../shared/component-contributions";
export const contributions: ComponentContributions = { menu: [{
  parent: "edls", node: {
    id: "edls-tos", label: "Absences", icon: "Stethoscope", href: "/edls/tos",
    testId: "menu-edls-tos", gate: { allOf: [{ component: "worker.tos" }, { policy: "edls.any" }] },
  },
}], tabs: [
  { entity: "worker", parent: "employment", tab: { id: "tos", label: "Time Off Sick", hrefTemplate: "/workers/{id}/employment/tos", permission: "staff", component: "worker.tos" } },
] };
