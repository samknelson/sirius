import type { ComponentDefinition } from "../../../shared/components";
export const component: ComponentDefinition = {
  id: "worker.badges", name: "Worker Badges",
  description: "Worker badges awarded through system activity and maintained by denorm plugins",
  enabledByDefault: false, category: "core", managesSchema: true,
  schemaManifest: { version: 1, schemaPath: "./components/worker.badges/shared/schema/worker/badges/schema.ts", tables: ["options_worker_badge_types", "worker_badges_denorm"] },
};
