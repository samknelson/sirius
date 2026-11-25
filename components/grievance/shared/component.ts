import type { ComponentDefinition } from "../../../shared/components";
export const component: ComponentDefinition = {
  id: "grievance",
  name: "Grievance",
  description: "Functionality for tracking and managing grievances",
  enabledByDefault: false,
  category: "core",
  managesSchema: true,
  schemaManifest: {
    version: 16,
    schemaPath: "./components/grievance/shared/schema/grievance/schema.ts",
    tables: ["options_grievance_status", "options_grievance_category", "options_grievance_steps", "options_grievance_complaints", "options_grievance_remedies", "options_grievance_roles", "grievances", "grievance_workers", "grievance_employers", "grievance_users", "grievance_complaints", "grievance_remedies", "grievance_steps_denorm", "grievance_timeline_templates", "grievance_timeline_template_steps", "grievance_name_denorm", "grievance_status_history"],
  },
};
