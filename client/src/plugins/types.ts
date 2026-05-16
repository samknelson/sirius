import { ComponentType } from "react";
import { Role } from "@shared/schema";

export interface DashboardPluginProps {
  userId: string;
  userRoles: Role[];
  userPermissions: string[];
  enabledComponents?: string[];
}

export interface DashboardPlugin {
  id: string;
  name: string;
  description: string;
  order: number;
  component: ComponentType<DashboardPluginProps>;
  requiredPermissions?: string[];
  requiredPolicy?: string;
  requiredComponent?: string;
  fullWidth?: boolean;
  enabledByDefault: boolean;
  /** When true, the config page links to the generic RJSF settings page. */
  hasSettings?: boolean;
}

export interface PluginConfig {
  pluginId: string;
  enabled: boolean;
}
