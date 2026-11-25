import type { ComponentDefinition } from "../../../shared/components";

export const component: ComponentDefinition = {
  id: "sitespecific.freeman.edls_migrate",
  name: "Freeman EDLS Migration",
  description: "Migration of EDLS data from Freeman's legacy system",
  enabledByDefault: false,
  category: "site-specific",
  managesSchema: true,
  schemaManifest: {
    version: 1,
    schemaPath: "./components/sitespecific.freeman.edls_migrate/shared/schema/sitespecific/freeman/edls-migrate-schema.ts",
    tables: ["sitespecific_freeman_edls_migrate"],
  },
  dependsOnComponents: ["edls", "sitespecific.freeman"],
};
