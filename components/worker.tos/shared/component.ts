import type { ComponentDefinition } from "../../../shared/components";
export const component: ComponentDefinition = {
  id: "worker.tos", name: "Time Off Sick",
  description: "Tracking of worker unplanned absences (Time Off Sick)",
  enabledByDefault: false, category: "core", managesSchema: true,
  schemaManifest: { version: 1, schemaPath: "./components/worker.tos/shared/schema/worker/tos/schema.ts", tables: ["worker_tos"] },
};
