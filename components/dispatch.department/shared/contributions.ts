import type { ComponentContributions } from "../../../shared/component-contributions";
export const contributions: ComponentContributions = {
  tabs: [{ entity: "worker", parent: "dispatch", before: "dispatch-hfe", tab: { id: "dispatch-departments", label: "Departments", hrefTemplate: "/workers/{id}/dispatch/departments", policyId: "worker.view", component: "dispatch.department" } }],
};
