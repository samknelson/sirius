import type { ComponentDefinition } from "../../../shared/components";
export const component: ComponentDefinition = {
  id: "worker.skills", name: "Worker Skills",
  description: "Management of worker skills and qualifications",
  enabledByDefault: false, category: "core", managesSchema: true,
  schemaManifest: { version: 1, schemaPath: "./components/worker.skills/shared/schema/worker/skills/schema.ts", tables: ["options_skills", "worker_skills"] },
};
