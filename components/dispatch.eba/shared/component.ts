import type { ComponentDefinition } from "../../../shared/components";
import "./types";
export const component: ComponentDefinition = {
  id: "dispatch.eba", name: "Employed but Available", description: "Tracks workers who are employed but available for dispatch",
  enabledByDefault: false, category: "dispatch", managesSchema: true,
  dependsOnComponents: ["dispatch"],
  schemaManifest: { version: 1, schemaPath: "./components/dispatch.eba/shared/schema/dispatch/eba-schema.ts", tables: ["worker_dispatch_eba"] },
};
