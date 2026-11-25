import type { ComponentContributions } from "../../../shared/component-contributions";
export const contributions: ComponentContributions = {
  tabs: [{ entity: "worker", parent: "dispatch", before: "dispatch-departments", tab: { id: "dispatch-dnc", label: "Do Not Call", hrefTemplate: "/workers/{id}/dispatch/do-not-call", policyId: "worker.view", component: "dispatch.dnc" } }],
};
