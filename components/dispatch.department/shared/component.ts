import type { ComponentDefinition } from "../../../shared/components";
export const component: ComponentDefinition = {
  id: "dispatch.department", name: "Dispatch Departments",
  description: "Worker department preferences and job departments for dispatch",
  enabledByDefault: false, category: "dispatch", managesSchema: true,
  dependsOnComponents: ["dispatch"],
  schemaManifest: { version: 1, schemaPath: "./components/dispatch.department/shared/schema/dispatch/department-schema.ts", tables: ["worker_dispatch_department", "dispatch_job_department"] },
};
