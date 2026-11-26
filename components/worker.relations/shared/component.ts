import type { ComponentDefinition } from "../../../shared/components";
export const component: ComponentDefinition = {
  id: "worker.relations", name: "Worker Relations",
  description: "Management of relationships between workers",
  enabledByDefault: false, category: "core", managesSchema: true,
  schemaManifest: { version: 1, schemaPath: "./components/worker.relations/shared/schema/worker/relations/schema.ts", tables: ["options_worker_relation_type", "worker_relations"] },
};
