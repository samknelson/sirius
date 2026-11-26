import type { ComponentDefinition } from "../../../shared/components";
export const component: ComponentDefinition = {
  id: "sitespecific.t631.interviews",
  name: "Teamsters 631 Interviews",
  description: "Job interview tracking for Teamsters 631",
  enabledByDefault: false,
  category: "site-specific",
  managesSchema: true,
  dependsOnComponents: ["dispatch"],
  schemaManifest: {
    version: 1,
    schemaPath: "./components/sitespecific.t631.interviews/shared/schema/sitespecific/t631/interviews-schema.ts",
    tables: ["sitespecific_t631_job_interviews"],
  },
};
