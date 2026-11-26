import type { ComponentDefinition } from "../../../shared/components";
export const component: ComponentDefinition = {
  id: "worker.aat", name: "Worker Access Tokens",
  description: "Per-worker access token (UUID) and access code",
  enabledByDefault: false, category: "core", managesSchema: true,
  schemaManifest: { version: 1, schemaPath: "./components/worker.aat/shared/schema/worker/aat/schema.ts", tables: ["worker_aat"] },
};
