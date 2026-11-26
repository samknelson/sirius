import type { ComponentDefinition } from "../../../shared/components";
export const component: ComponentDefinition = {
  id: "worker.ratings", name: "Worker Ratings",
  dependsOnComponents: ["edls"],
  description: "Management of worker performance ratings",
  enabledByDefault: false, category: "core", managesSchema: true,
  schemaManifest: { version: 1, schemaPath: "./components/worker.ratings/shared/schema/worker/ratings/schema.ts", tables: ["options_worker_ratings", "worker_ratings"] },
};
