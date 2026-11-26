import type { ComponentDefinition } from "../../../shared/components";

export const component: ComponentDefinition = {
  id: "bookmark",
  name: "Bookmarks",
  description: "Personal bookmarks for records",
  enabledByDefault: true,
  category: "core",
  managesSchema: true,
  schemaManifest: {
    version: 1,
    schemaPath: "./components/bookmark/shared/schema/bookmarks.ts",
    tables: ["bookmarks"],
  },
  permissions: [{
    key: "bookmark",
    description: "Create and manage bookmarks for workers and employers",
  }],
};
