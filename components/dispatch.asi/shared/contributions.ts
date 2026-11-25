import type { ComponentContributions } from "../../../shared/component-contributions";
export const contributions: ComponentContributions = {
  tabs: [{ entity: "worker", parent: "dispatch", tab: { id: "dispatch-asi", label: "Auto Sign-In", hrefTemplate: "/workers/{id}/dispatch/asi", policyId: "worker.dispatch.asi", component: "dispatch.asi" } }],
};
