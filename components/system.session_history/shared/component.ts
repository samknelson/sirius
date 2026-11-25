import type { ComponentDefinition } from "../../../shared/components";

export const component: ComponentDefinition = {
  id: "system.session_history",
  name: "Session History",
  description: "Persistent history of user login sessions",
  enabledByDefault: false,
  category: "core",
  managesSchema: true,
  schemaManifest: {
    version: 1,
    schemaPath: "./components/system.session_history/shared/schema/system/session-history-schema.ts",
    tables: ["session_history"],
  },
};
