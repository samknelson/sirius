import type { ComponentContributions } from "../../../shared/component-contributions";
export const contributions: ComponentContributions = { menu: [{
  parent: "workers", before: "class-size-grievances", node: {
    id: "stewards", labelTerm: { key: "steward", plural: true }, icon: "Shield",
    href: "/stewards", testId: "menu-stewards",
    gate: { allOf: [{ policy: "staff" }, { component: "worker.steward" }] },
  },
}], tabs: [
  { entity: "worker", parent: "union", tab: { id: "steward", label: "Steward", hrefTemplate: "/workers/{id}/union/steward", permission: "staff", component: "worker.steward", termKey: "steward" } },
  { entity: "employer", tab: { id: "union", label: "Union", hrefTemplate: "/employers/{id}/union/stewards", policyId: "employer.steward.view", component: "worker.steward", children: [
    { id: "stewards", label: "Stewards", hrefTemplate: "/employers/{id}/union/stewards", policyId: "employer.steward.view", component: "worker.steward", termKey: "steward", termPlural: true },
  ] } },
] };
