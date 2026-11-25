import type { ComponentDefinition } from "../../../shared/components";

export const components: ComponentDefinition[] = [
  {
    id: "sitespecific.freeman",
    name: "Freeman Customization",
    description: "Custom functionality for Freeman",
    enabledByDefault: false,
    category: "site-specific",
    managesSchema: true,
    schemaManifest: {
      version: 1,
      schemaPath: "./components/freeman/shared/schema/sitespecific/freeman/schema.ts",
      tables: ["sitespecific_freeman_crewleads"],
    },
  },
  {
    id: "sitespecific.freeman.edls_migrate",
    name: "Freeman EDLS Migration",
    description: "Migration of EDLS data from Freeman's legacy system",
    enabledByDefault: false,
    category: "site-specific",
    managesSchema: true,
    schemaManifest: {
      version: 1,
      schemaPath: "./components/freeman/shared/schema/sitespecific/freeman/edls-migrate-schema.ts",
      tables: ["sitespecific_freeman_edls_migrate"],
    },
    dependsOnComponents: ["edls", "sitespecific.freeman"],
  },
  {
    id: "sitespecific.freeman.authorization",
    name: "Freeman Authorization",
    description: "Bearer authorization service for Freeman integrations",
    enabledByDefault: false,
    category: "site-specific",
  },
];
