import { ComponentType } from "react";
import { Role } from "@shared/schema";
import type { QueryClient } from "@tanstack/react-query";

export interface DashboardPluginProps {
  userId: string;
  userRoles: Role[];
  userPermissions: string[];
}

export interface PluginSettingsProps {
  plugin: DashboardPlugin;
  queryClient: QueryClient;
  onConfigSaved?: () => void;
}

export interface DashboardPlugin {
  id: string;
  name: string;
  description: string;
  order: number;
  component: ComponentType<DashboardPluginProps>;
  requiredPermissions?: string[];
  enabledByDefault: boolean;
  settingsComponent?: ComponentType<PluginSettingsProps>;
}

export interface PluginConfig {
  pluginId: string;
  enabled: boolean;
}
