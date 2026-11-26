import type { ComponentDefinition } from "../../../shared/components";
import "./worker-sync-result";

export const component: ComponentDefinition = {
  id: "sitespecific.freeman",
  name: "Freeman Customization",
  description: "Custom functionality for Freeman",
  enabledByDefault: false,
  category: "site-specific",
  pluginConfigs: [
    {
      pluginKind: "web-service",
      pluginId: "edls-sheet-export-v1",
      siriusId: "auto.edls.sheet-export-v1",
      name: "EDLS Sheet Export v1",
      data: { alias: "edls-sheet-export-v1" },
    },
  ],
  managesSchema: true,
  schemaManifest: {
    version: 1,
    schemaPath: "./components/sitespecific.freeman/shared/schema/sitespecific/freeman/schema.ts",
    tables: ["sitespecific_freeman_crewleads"],
    dependsOnComponents: ["edls"],
  },
};
