import type { ComponentContributions } from "../../../shared/component-contributions";
export const contributions: ComponentContributions = {
  tabs: [{ entity: "worker", parent: "dispatch", before: "dispatch-eba", tab: { id: "dispatch-hfe", label: "Employer Priority", hrefTemplate: "/workers/{id}/dispatch/hold-for-employer", policyId: "worker.view", component: "dispatch.hfe" } }],
};
