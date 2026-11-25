import type { ComponentDefinition } from "../../../shared/components";
export const component: ComponentDefinition = {
  id: "dispatch.fore", name: "Dispatch Forepersons", description: "Track Forepersons designated on dispatch jobs",
  enabledByDefault: false, category: "dispatch", managesSchema: true,
  schemaManifest: { version: 1, schemaPath: "./components/dispatch.fore/shared/schema/dispatch/fore-schema.ts", tables: ["dispatch_job_fore"], dependsOnComponents: ["dispatch"] },
};
