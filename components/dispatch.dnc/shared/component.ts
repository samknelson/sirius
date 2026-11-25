import type { ComponentDefinition } from "../../../shared/components";
declare module "../../../shared/accessPolicies" {
  interface ComponentPolicyEntityTypes { "worker.dispatch.dnc": true }
}
export const component: ComponentDefinition = {
  id: "dispatch.dnc", name: "Dispatch Do Not Call", description: "Do Not Call list management for dispatch",
  enabledByDefault: false, category: "dispatch", managesSchema: true,
  schemaManifest: { version: 1, schemaPath: "./components/dispatch.dnc/shared/schema/dispatch/dnc-schema.ts", tables: ["worker_dispatch_dnc"] },
  permissions: [{ key: "worker", description: "Worker access to their own data" }],
  policies: [
    { id: "worker.dispatch.dnc.view", description: "View DNC records associated with the user's worker or employer", scope: "entity", entityType: "worker.dispatch.dnc", rules: [{ permission: "staff" }] },
    { id: "worker.dispatch.dnc.edit", description: "Edit DNC records - workers edit type='worker', employers edit type='employer'", scope: "entity", entityType: "worker.dispatch.dnc", rules: [{ permission: "staff" }] },
  ],
};
