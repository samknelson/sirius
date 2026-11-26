import type { ComponentContributions } from "../../../shared/component-contributions";
export const contributions: ComponentContributions = { tabs: [
  { entity: "worker", parent: "identity", before: "bans", tab: { id: "badges", label: "Badges", hrefTemplate: "/workers/{id}/badges", policyId: "worker.view", component: "worker.badges" } },
] };
