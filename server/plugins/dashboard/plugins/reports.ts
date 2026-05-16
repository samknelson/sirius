import { storage } from "../../../storage";
import { wizardRegistry } from "../../../wizards";
import type { JsonSchema } from "@shared/json-schema-form";
import type { DashboardPlugin } from "../types";

async function buildSchema(): Promise<JsonSchema> {
  const roles = await storage.users.getAllRoles();
  const reportTypes = wizardRegistry.getAll().filter((t) => t.isReport);
  const enumValues = reportTypes.map((t) => t.name);
  const enumNames = reportTypes.map((t) => t.displayName || t.name);
  const properties: Record<string, JsonSchema> = {};
  for (const role of roles) {
    properties[role.id] = {
      type: "array",
      title: role.name,
      description: role.description || undefined,
      uniqueItems: true,
      items: {
        type: "string",
        enum: enumValues,
        enumNames,
      } as JsonSchema,
    };
  }
  return {
    type: "object",
    title: "Dashboard Reports",
    description: "Configure which reports appear on the dashboard for each role.",
    properties,
  };
}

async function buildUiSchema() {
  const roles = await storage.users.getAllRoles();
  const ui: Record<string, any> = {};
  for (const role of roles) {
    ui[role.id] = { "ui:widget": "checkboxes" };
  }
  return ui;
}

export const reportsPlugin: DashboardPlugin = {
  id: "reports",
  name: "Reports",
  description: "Display recent report summaries with links to details",
  settingsSchema: buildSchema,
  uiSchema: buildUiSchema,
  defaultSettings: {},
};
