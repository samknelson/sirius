import type { ComponentContributions } from "../../../shared/component-contributions";
declare module "../../../shared/schema/dispatch/eligibility-config" {
  interface DispatchJobData {
    /** Stored option IDs; preserve while the owning UI is unavailable. */
    requiredSkills?: string[];
  }
}
export const contributions: ComponentContributions = { tabs: [
  { entity: "worker", parent: "identity", before: "bans", tab: { id: "skills", label: "Skills", hrefTemplate: "/workers/{id}/skills", policyId: "worker.view", component: "worker.skills" } },
] };
