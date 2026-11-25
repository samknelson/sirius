import type { ComponentDefinition } from "../../../shared/components";
export const component: ComponentDefinition = {
  id: "grievance.contract",
  name: "Grievance Contract",
  description: "Linking grievances to contract sections. Requires the Grievance and Contract components to be enabled — its foreign keys reference the grievances and contract_sections tables.",
  enabledByDefault: false,
  category: "grievance",
  managesSchema: true,
  schemaManifest: {
    version: 2,
    schemaPath: "./components/grievance.contract/shared/schema/grievance/contract-schema.ts",
    tables: ["grievance_contract_sections", "grievance_contracts"],
    dependsOnComponents: ["grievance", "contract"],
  },
};
