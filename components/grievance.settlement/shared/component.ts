import type { ComponentDefinition } from "../../../shared/components";
export const component: ComponentDefinition = {
  id: "grievance.settlement",
  name: "Grievance Settlement",
  description: "Tracking settlements recorded against grievances. Requires the Grievance component to be enabled — settlements reference grievance records.",
  enabledByDefault: false,
  category: "grievance",
  managesSchema: true,
  dependsOnComponents: ["grievance"],
  schemaManifest: {
    version: 1,
    schemaPath: "./components/grievance.settlement/shared/schema/grievance/settlement-schema.ts",
    tables: ["options_grievance_settlement_type", "grievance_settlements"],
  },
};
