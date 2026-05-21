import type { Request } from "express";
import type { JsonSchema } from "@shared/json-schema-form";
import type { User } from "@shared/schema";
import type { storage as storageType } from "../../storage";

export interface DashboardContentContext {
  userId: string;
  userRoles: Array<{ id: string; name: string }>;
  dbUser: User;
  query: Record<string, unknown>;
  settings: any;
  req: Request;
  storage: typeof storageType;
}

export type DashboardContentResolver = (
  ctx: DashboardContentContext,
) => Promise<any>;

export interface DashboardPluginUiSchema {
  [key: string]: any;
}

export interface DashboardPlugin {
  id: string;
  name: string;
  description: string;
  /** Component gating - if set, plugin is only enabled when this component is on. */
  componentId?: string;
  /** Policy gating - if set, the user must satisfy this policy on /content. */
  requiredPolicy?: string;
  /** JSON Schema for plugin settings. May be sync or async (e.g. dynamic, role-based). */
  settingsSchema?: JsonSchema | (() => Promise<JsonSchema>);
  /** Optional uiSchema for RJSF. May be sync or async. */
  uiSchema?: DashboardPluginUiSchema | (() => Promise<DashboardPluginUiSchema>);
  /** Default settings value when no variable exists. */
  defaultSettings?: any;
  /**
   * Optional one-shot legacy migration. Runs at boot if the
   * `dashboard_plugin_<id>_settings` variable does not yet exist.
   * Should return the migrated settings, or null/undefined to skip.
   */
  migrateLegacySettings?: () => Promise<any>;
  /**
   * Content resolver(s). May be a single resolver (served at /content)
   * or a map of action → resolver (served at /content/:action).
   * Plugins with no server-side content (e.g. bookmarks) may omit this.
   */
  content?: DashboardContentResolver | Record<string, DashboardContentResolver>;
}
