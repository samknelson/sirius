import type { Request } from "express";
import type { JsonSchema } from "@shared/json-schema-form";
import type { PluginRegistry } from "./registry";

/** Result shape returned by validate / save admin callbacks. */
export type PluginValidationResult =
  | { valid: true }
  | { valid: false; errors?: string[] };

/** Settings payload returned by `getSettings`. */
export interface PluginSettingsPayload {
  schema: JsonSchema;
  uiSchema: Record<string, unknown>;
  value: unknown;
}

/** Per-plugin enabled snapshot returned by `listEnabled`. */
export interface PluginEnabledEntry {
  pluginId: string;
  enabled: boolean;
}

/**
 * Registry of plugin kinds. The unified `/api/plugins/:kind/manifest`
 * endpoint looks up kinds here and delegates to the appropriate
 * `PluginRegistry` instance.
 *
 * Each kind opts in by calling `registerPluginKind(kind, registry, opts)`
 * once during boot.
 */
export interface PluginKindRegistration<TPlugin = unknown, TEntry = unknown> {
  kind: string;
  registry: PluginRegistry<TPlugin, TEntry>;
  /**
   * Optional human-readable label for the kind, surfaced by the
   * `/api/plugins/kinds` index endpoint (and the admin index page that
   * consumes it). When omitted, the endpoint derives a sensible label
   * from the kind id (e.g. "trust-eligibility" → "Trust Eligibility").
   */
  label?: string;
  /**
   * Kind-level component gate. If set, the entire manifest endpoint
   * 403s when the component is disabled. Mirrors the legacy
   * `requireComponent(...)` middleware that protected the per-kind
   * manifest endpoints before Task #208.
   */
  requiredComponent?: string;
  /**
   * Kind-level access-policy gate. If set, the manifest endpoint
   * 403s when the current user does not satisfy the policy. Mirrors
   * the legacy `requireAccess('admin')` middleware that protected
   * the charge / dispatch-eligibility / trust-eligibility manifest
   * endpoints. The dashboard manifest intentionally omits this so
   * every authenticated user can list their dashboard widgets.
   */
  requiredPolicy?: string;
  /**
   * Optional sort function applied to manifest entries before they are
   * returned to the caller. Defaults to alphabetical by `id`.
   */
  sortEntries?: (a: TEntry, b: TEntry) => number;
  /**
   * Optional post-processor for the final manifest array (e.g. to
   * inject runtime fields like "enabled" pulled from variables).
   */
  decorateEntries?: (entries: TEntry[], req: Request) => Promise<TEntry[]> | TEntry[];
  /**
   * Optional admin capabilities. Each is wired up by the generic
   * `/api/plugins/:kind/...` admin endpoints in
   * `server/modules/plugins-admin.ts`. The endpoint 404s when the
   * corresponding callback is not provided. All callbacks run AFTER
   * the same kind-level component + access-policy gating as the
   * manifest endpoint, and (where a single plugin is targeted) AFTER
   * per-plugin component gating.
   *
   * - `validateConfig`  → POST /api/plugins/:kind/:id/validate-config
   * - `listEnabled`     → GET  /api/plugins/:kind/enabled
   * - `setEnabled`      → PUT  /api/plugins/:kind/:id/enabled
   * - `getSettings`     → GET  /api/plugins/:kind/:id/settings
   * - `saveSettings`    → PUT  /api/plugins/:kind/:id/settings
   */
  validateConfig?: (
    plugin: TPlugin,
    config: unknown,
  ) => Promise<PluginValidationResult> | PluginValidationResult;
  listEnabled?: () => Promise<PluginEnabledEntry[]> | PluginEnabledEntry[];
  setEnabled?: (plugin: TPlugin, enabled: boolean) => Promise<void> | void;
  getSettings?: (
    plugin: TPlugin,
  ) => Promise<PluginSettingsPayload | null> | PluginSettingsPayload | null;
  saveSettings?: (
    plugin: TPlugin,
    value: unknown,
  ) => Promise<PluginValidationResult | void> | PluginValidationResult | void;
}

const KINDS = new Map<string, PluginKindRegistration<any, any>>();

export function registerPluginKind<TPlugin, TEntry>(
  registration: PluginKindRegistration<TPlugin, TEntry>,
): void {
  if (KINDS.has(registration.kind)) {
    throw new Error(`Plugin kind '${registration.kind}' already registered`);
  }
  KINDS.set(registration.kind, registration);
}

export function getPluginKind(kind: string): PluginKindRegistration | undefined {
  return KINDS.get(kind);
}

export function listPluginKinds(): string[] {
  return Array.from(KINDS.keys());
}
