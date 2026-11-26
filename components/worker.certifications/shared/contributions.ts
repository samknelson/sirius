import type { ComponentContributions } from "../../../shared/component-contributions";
declare module "../../../shared/tabRegistry" { interface TabEntityTypes { worker_certification: true } }
export const contributions: ComponentContributions = { tabs: [
  { entity: "worker", parent: "identity", before: "bans", tab: { id: "certifications", label: "Certifications", hrefTemplate: "/workers/{id}/certifications", policyId: "worker.view", component: "worker.certifications" } },
  { entity: "worker_certification", tab: { id: "view", label: "View", hrefTemplate: "/worker-certification/{id}", component: "worker.certifications" } },
  { entity: "worker_certification", tab: { id: "edit", label: "Edit", hrefTemplate: "/worker-certification/{id}/edit", permission: "staff", component: "worker.certifications" } },
] };
