import type { ComponentContributions } from "../../../shared/component-contributions";
export const contributions: ComponentContributions = {
  tabs: [{ entity: "dispatch_job", before: "dispatch-job-employer-contacts", tab: { id: "foreperson", label: "Foreperson", hrefTemplate: "/dispatch/job/{id}/foreperson", permission: "staff", component: "dispatch.fore" } }],
};
