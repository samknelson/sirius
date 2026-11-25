import type { ComponentDefinition } from "../../../shared/components";
export const component: ComponentDefinition = {
  id: "dispatch.asi", name: "Auto Sign-In", description: "Auto Sign-In tracking for dispatch workers",
  enabledByDefault: false, category: "dispatch", managesSchema: true,
  schemaManifest: { version: 1, schemaPath: "./components/dispatch.asi/shared/schema/dispatch/asi-schema.ts", tables: ["worker_dispatch_asi"] },
  permissions: [{ key: "worker.dispatch.asi", description: "Access to Auto Sign-In dispatch functionality" }],
};
