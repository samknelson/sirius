import type { ComponentContributions } from "../../../shared/component-contributions";
export const contributions: ComponentContributions = {
  tabs: [{ entity: "worker", parent: "dispatch", before: "dispatch-asi", tab: { id: "dispatch-eba", label: "Availability Dates", hrefTemplate: "/workers/{id}/dispatch/eba", policyId: "worker.mine", component: "dispatch.eba" } }],
};
