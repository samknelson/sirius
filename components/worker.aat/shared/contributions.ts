import type { ComponentContributions } from "../../../shared/component-contributions";
export const contributions: ComponentContributions = { tabs: [
  { entity: "worker", parent: "identity", tab: { id: "aat", label: "Access Tokens", hrefTemplate: "/workers/{id}/aat", policyId: "worker.mine", component: "worker.aat" } },
] };
