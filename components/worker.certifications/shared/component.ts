import type { ComponentDefinition } from "../../../shared/components";
export const component: ComponentDefinition = {
  id: "worker.certifications", name: "Worker Certifications",
  description: "Management of worker certifications and credentials",
  enabledByDefault: false, category: "core", managesSchema: true,
  dependsOnComponents: ["worker.skills"],
  schemaManifest: { version: 1, schemaPath: "./components/worker.certifications/shared/schema/worker/certifications/schema.ts", tables: ["options_certifications", "worker_certifications"] },
};
