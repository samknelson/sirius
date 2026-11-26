import type { ComponentDefinition } from "../../../shared/components";
export const component: ComponentDefinition = {
  id: "worker.steward", name: "Shop Stewards",
  description: "Ability to designate workers as shop stewards",
  enabledByDefault: false, category: "core", managesSchema: true,
  schemaManifest: { version: 1, schemaPath: "./components/worker.steward/shared/schema/worker/steward/schema.ts", tables: ["worker_steward_assignments"] },
  permissions: [{ key: "worker.steward", description: "Access to shop steward functionality for workers" }],
};
