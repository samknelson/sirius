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

// Plugin metadata registry
export const pluginMetadata: Record<string, PluginMetadata> = {
  "welcome_messages": {
    id: "welcome_messages",
    requiredPermissions: ["admin"],
    settingsSchema: welcomeMessagesSettingsSchema,
  },
  "employer_monthly": {
    id: "employer_monthly",
    requiredPermissions: ["admin"],
    settingsSchema: employerMonthlySettingsSchema,
  },
};

export function getPluginMetadata(pluginId: string): PluginMetadata | undefined {
  return pluginMetadata[pluginId];
}
