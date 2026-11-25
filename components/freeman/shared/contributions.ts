import type { PackageContributions } from "../../../shared/package-contributions";

export const contributions: PackageContributions = {
  tabs: [
    { entity: "worker", before: "sitespecific-bao-beneficiaries", tab: { id: "sitespecific-freeman-2shift", label: "Second Shift", hrefTemplate: "/workers/{id}/sitespecific-freeman-2shift", policyId: "edls.any", component: "sitespecific.freeman" } },
    { entity: "ws_client", before: "test", tab: { id: "freeman-bearer-authorization", label: "Freeman Bearer Authorization", hrefTemplate: "/admin/ws/clients/{id}/freeman-bearer-authorization", permission: "admin", component: "sitespecific.freeman.authorization" } },
  ],
  menu: [{ parent: "edls", node: {
    id: "edls-freeman-crewleads", label: "Crew Leads", icon: "UserCheck",
    href: "/edls/freeman/crewleads", testId: "menu-edls-freeman-crewleads",
    gate: { allOf: [{ component: "sitespecific.freeman" }, { policy: "edls.any" }] },
  } }],
  operationAliases: {
    "authorize-bearer": "sitespecific.freeman.authorization.bearer",
    "sitespecific.freeman.edls_migrate": "sitespecific.freeman.edls.migrate",
    sirius_freeman_rawdata: "sitespecific.freeman.edls.migrate",
  },
  carryingBranches: ["freeman-dev", "freeman-uat"],
};
