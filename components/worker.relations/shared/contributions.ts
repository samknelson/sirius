import type { ComponentContributions } from "../../../shared/component-contributions";
export const contributions: ComponentContributions = { tabs: [
  { entity: "worker", parent: "contact", tab: { id: "relations", label: "Relations", hrefTemplate: "/workers/{id}/relations", policyId: "worker.view", component: "worker.relations" } },
] };
