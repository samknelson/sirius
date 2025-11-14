import { ComponentType } from "react";
import { Role } from "@shared/schema";
import type { QueryClient } from "@tanstack/react-query";
import type { z } from "zod";

export interface DashboardPluginProps {
  userId: string;
  userRoles: Role[];
  userPermissions: string[];
}

export interface PluginSettingsProps<T = any> {
  plugin: DashboardPlugin;
  queryClient: QueryClient;
  onConfigSaved?: () => void;
  loadSettings: () => Promise<T>;
  saveSettings: (settings: T) => Promise<void>;
}

export interface DashboardPlugin {
  id: string;
  name: string;
  description: string;
  order: number;
  component: ComponentType<DashboardPluginProps>;
  requiredPermissions?: string[];
  enabledByDefault: boolean;
  settingsComponent?: ComponentType<PluginSettingsProps<any>>;
  settingsSchema?: z.ZodType<any>;
}

export interface PluginConfig {
  pluginId: string;
  enabled: boolean;
}
