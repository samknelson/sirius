import type { ComponentDefinition } from "../../../shared/components";
export const component: ComponentDefinition = {
  id: "dispatch.hfe", name: "Dispatch Employer Priority", description: "Employer Priority management for dispatch",
  enabledByDefault: false, category: "dispatch", managesSchema: true,
  dependsOnComponents: ["dispatch"],
  schemaManifest: { version: 1, schemaPath: "./components/dispatch.hfe/shared/schema/dispatch/hfe-schema.ts", tables: ["worker_dispatch_hfe"] },
};
