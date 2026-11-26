import type { ComponentDefinition } from "../../../shared/components";

export const component: ComponentDefinition = {
  id: "edls",
  name: "Employer Day Labor Scheduler",
  description: "Day labor scheduling functionality for employers",
  enabledByDefault: false,
  category: "core",
  managesSchema: true,
  dependsOnComponents: ["dispatch.job_group", "facility"],
  schemaManifest: {
    version: 1,
    schemaPath: "./components/edls/shared/schema/edls/schema.ts",
    tables: ["options_edls_tasks", "options_edls_show_status", "edls_sheets", "edls_crews", "edls_assignments", "worker_edls"],
  },
  permissions: [
    { key: "edls.manager", description: "Full EDLS management access" },
    { key: "edls.coordinator", description: "EDLS coordination and scheduling access" },
    { key: "edls.supervisor", description: "EDLS supervisory access" },
    { key: "edls.reader", description: "Read-only access to EDLS data" },
    { key: "edls.worker.advisor", description: "Worker advisor access for EDLS" },
  ],
};
