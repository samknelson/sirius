import type { ComponentContributions } from "../../../shared/component-contributions";

export const contributions: ComponentContributions = {
  tabs: [
    { entity: "worker", before: "sitespecific-bao-beneficiaries", tab: { id: "sitespecific-freeman-2shift", label: "Second Shift", hrefTemplate: "/workers/{id}/sitespecific-freeman-2shift", policyId: "edls.any", component: "sitespecific.freeman" } },
  ],
  menu: [{ parent: "edls", node: {
    id: "edls-freeman-crewleads", label: "Crew Leads", icon: "UserCheck",
    href: "/edls/freeman/crewleads", testId: "menu-edls-freeman-crewleads",
    gate: { allOf: [{ component: "sitespecific.freeman" }, { policy: "edls.any" }] },
  } }],
  carryingBranches: ["freeman-dev", "freeman-uat"],
};
