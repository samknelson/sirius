import { z } from "zod";

// Plugin metadata that can be shared between client and server
// Client-side components are not included here
export interface PluginMetadata {
  id: string;
  requiredPermissions?: string[];
  settingsSchema?: z.ZodType<any>;
}

// Welcome Messages Plugin Settings Schema
export const welcomeMessagesSettingsSchema = z.record(z.string(), z.string());

// Employer Monthly Plugin Settings Schema  
export const employerMonthlySettingsSchema = z.record(z.string(), z.array(z.string()));

// Reports Plugin Settings Schema (maps role IDs to arrays of report type names)
export const reportsSettingsSchema = z.record(z.string(), z.array(z.string()));

// Plugin metadata registry
export const pluginMetadata: Record<string, PluginMetadata> = {
  "welcome-messages": {
    id: "welcome-messages",
    requiredPermissions: ["admin"],
    settingsSchema: welcomeMessagesSettingsSchema,
  },
  "employer-monthly-uploads": {
    id: "employer-monthly-uploads",
    requiredPermissions: ["admin"],
    settingsSchema: employerMonthlySettingsSchema,
  },
  "reports": {
    id: "reports",
    requiredPermissions: ["admin"],
    settingsSchema: reportsSettingsSchema,
  },
};

export function getPluginMetadata(pluginId: string): PluginMetadata | undefined {
  return pluginMetadata[pluginId];
}
