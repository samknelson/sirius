import { storage } from "../../../../storage";
import type { JsonSchema } from "@shared/json-schema-form";
import type { DashboardPlugin } from "../../types";

async function buildSchema(): Promise<JsonSchema> {
  const roles = await storage.users.getAllRoles();
  const properties: Record<string, JsonSchema> = {};
  for (const role of roles) {
    properties[role.id] = {
      type: "string",
      title: role.name,
      description: role.description || undefined,
    };
  }
  return {
    type: "object",
    title: "Dashboard Welcome Messages",
    description:
      "Configure custom welcome messages for each role. HTML is sanitized for security.",
    properties,
  };
}

async function buildUiSchema() {
  const roles = await storage.users.getAllRoles();
  const ui: Record<string, any> = {};
  for (const role of roles) {
    ui[role.id] = { "ui:widget": "htmlEditor" };
  }
  return ui;
}

export const welcomeMessagesPlugin: DashboardPlugin = {
  id: "welcome-messages",
  name: "Welcome Messages",
  description: "Display role-specific welcome messages for the user",
  settingsSchema: buildSchema,
  uiSchema: buildUiSchema,
  defaultSettings: {},

  async migrateLegacySettings() {
    const roles = await storage.users.getAllRoles();
    const migrated: Record<string, string> = {};
    for (const role of roles) {
      const legacy = await storage.variables.getByName(`welcome_message_${role.id}`);
      if (legacy && typeof legacy.value === "string") {
        migrated[role.id] = legacy.value;
      }
    }
    return migrated;
  },

  async content(ctx) {
    const all = (ctx.settings ?? {}) as Record<string, string>;
    const messages: Array<{ roleId: string; roleName: string; message: string }> = [];
    for (const role of ctx.userRoles) {
      const message = all[role.id];
      if (message) {
        messages.push({ roleId: role.id, roleName: role.name, message });
      }
    }
    return { messages };
  },
};
