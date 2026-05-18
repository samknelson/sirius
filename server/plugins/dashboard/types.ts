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

/**
 * Client-side rendering metadata for a dashboard plugin. Plugins without a
 * `client` block do not appear on the dashboard but may still expose
 * /content endpoints (headless data feeds).
 */
export interface DashboardPluginClient {
  /**
   * Component identifier resolved by client/src/plugins/dashboard/registry.ts.
   * Format: `<plugin-id>:<ComponentName>` (e.g. `"welcome-messages:WelcomeMessages"`)
   * or `"generic:<Name>"` for stock components.
   */
  component: string;
  /** JSON-serializable props passed through to the component. */
  componentProps?: Record<string, unknown>;
  /** Sort order on the dashboard (lowest first). */
  order: number;
  /** When true, the widget renders full-width above the grid. */
  fullWidth?: boolean;
  /**
   * UI-hint permission gate. The user must hold at least one of these
   * permissions for the widget to be shown. /content remains the
   * authoritative enforcement point.
   */
  requiredPermissions?: string[];
  /** Defaults to true when omitted. */
  enabledByDefault?: boolean;
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
  /**
   * Client rendering metadata. Plugins without this block do not appear on
   * the dashboard (headless plugins).
   */
  client?: DashboardPluginClient;
}
