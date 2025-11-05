import { ComponentType } from "react";
import { Role } from "@shared/schema";

export interface DashboardPluginProps {
  userId: string;
  userRoles: Role[];
  userPermissions: string[];
}

export interface DashboardPlugin {
  id: string;
  name: string;
  description: string;
  order: number;
  component: ComponentType<DashboardPluginProps>;
  requiredPermissions?: string[];
  enabledByDefault: boolean;
}

export interface PluginConfig {
  pluginId: string;
  enabled: boolean;
}
