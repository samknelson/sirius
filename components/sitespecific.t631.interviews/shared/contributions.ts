import type { ComponentContributions } from "../../../shared/component-contributions";
export const contributions: ComponentContributions = {
  tabs: [
    { entity: "worker", parent: "dispatch", tab: { id: "dispatch-t631-interviews", label: "Interviews", hrefTemplate: "/workers/{id}/dispatch/sitespecific_t631_interviews", policyId: "worker.view", component: "sitespecific.t631.interviews" } },
    { entity: "dispatch_job", before: "employer-contacts", tab: {
      id: "sitespecific-t631-interviews", label: "Interviews",
      hrefTemplate: "/dispatch/job/{id}/sitespecific_t631_interviews",
      policyId: "sitespecific.t631.job.interviews", component: "sitespecific.t631.interviews",
      children: [
        { id: "sitespecific-t631-interviews-list", label: "List", hrefTemplate: "/dispatch/job/{id}/sitespecific_t631_interviews", policyId: "sitespecific.t631.job.interviews", component: "sitespecific.t631.interviews" },
        { id: "sitespecific-t631-interviews-offers", label: "Offers", hrefTemplate: "/dispatch/job/{id}/sitespecific_t631_interviews/offers", permission: "staff", component: "sitespecific.t631.interviews" },
      ],
    } },
  ],
};
