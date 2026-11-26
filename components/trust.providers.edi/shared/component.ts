import type { ComponentDefinition } from "../../../shared/components";
export const component: ComponentDefinition = {
  id: "trust.providers.edi",
  name: "Provider Data Interchange",
  description: "Data interchange functionality for trust providers (EDI file plugin configs and delivery)",
  enabledByDefault: false,
  category: "trust.providers",
  managesSchema: true,
  dependsOnComponents: ["system.sftp.client"],
  schemaManifest: {
    version: 1,
    schemaPath: "./components/trust.providers.edi/shared/schema/trust/provider-edi-schema.ts",
    tables: ["plugin_configs_trust_provider_edi"],
  },
};
