import { z } from "zod";
import type { PluginConfigWithSubsidiary } from "../../storage/plugin-configs";

/**
 * Per-kind plugin-config adapter (Task #353 — additive foundation).
 *
 * The unified plugin config storage (`storage.pluginConfigs`) is generic: a
 * base `plugin_configs` row plus an optional per-kind subsidiary row. The
 * generic CRUD + search routes in `server/modules/plugins-config.ts` know
 * nothing kind-specific — they delegate every kind-specific concern to the
 * adapter registered for that kind:
 *
 *   - `configSchema`        validates the flat create/update payload.
 *   - `searchParamsSchema`  validates the search request body.
 *   - `toRows`              splits a validated config into the base row +
 *                           optional subsidiary row (without the shared id,
 *                           which the route fills in after the base insert).
 *   - `hydrate`             merges a stored envelope back into the flat shape
 *                           returned to clients.
 *
 * A new plugin kind becomes fully manageable by registering one adapter —
 * no new storage methods, routes, or frontend required.
 */
export interface PluginConfigRows {
  base: {
    pluginType: string;
    pluginId: string;
    enabled?: boolean;
    name?: string | null;
    ordering?: number;
    data?: unknown;
  };
  /** Subsidiary columns (without `id`). Omit for kinds with no subsidiary. */
  subsidiary?: Record<string, unknown>;
}

export interface PluginConfigAdapter<TConfig = any, TSearch = any> {
  /** PluginKind discriminator — matches the `:kind` URL segment. */
  pluginType: string;
  /** Validates the flat create/update payload. */
  configSchema: z.ZodType<TConfig>;
  /** Validates the search request body (filters; all optional). */
  searchParamsSchema: z.ZodType<TSearch>;
  /** Split a validated config into base + optional subsidiary rows. */
  toRows(input: TConfig): PluginConfigRows;
  /**
   * Merge a stored envelope back into the flat API shape. Optional — falls
   * back to {@link defaultHydrate} (base columns + flattened subsidiary).
   */
  hydrate?(envelope: PluginConfigWithSubsidiary): Record<string, unknown>;
}

/** Reusable schema shape for the base columns every flat config carries. */
export const baseConfigSchemaShape = {
  pluginId: z.string().min(1),
  name: z.string().nullable().optional(),
  enabled: z.boolean().optional().default(false),
  ordering: z.number().int().optional().default(0),
  data: z.unknown().optional().default({}),
};

/** Reusable schema shape for the base search filters every kind accepts. */
export const baseSearchSchemaShape = {
  pluginId: z.string().optional(),
  enabled: z.boolean().optional(),
};

/**
 * Default hydration: flatten the envelope into `{ ...base, ...subsidiary }`
 * with the subsidiary's duplicate `id` stripped (the base `id` wins).
 */
export function defaultHydrate(envelope: PluginConfigWithSubsidiary): Record<string, unknown> {
  const { config, subsidiary } = envelope;
  const sub = subsidiary ? { ...subsidiary } : {};
  delete (sub as Record<string, unknown>).id;
  return { ...config, ...sub };
}

const ADAPTERS = new Map<string, PluginConfigAdapter>();

export function registerPluginConfigAdapter(adapter: PluginConfigAdapter): void {
  if (ADAPTERS.has(adapter.pluginType)) {
    throw new Error(`Plugin config adapter for '${adapter.pluginType}' already registered`);
  }
  ADAPTERS.set(adapter.pluginType, adapter);
}

export function getPluginConfigAdapter(pluginType: string): PluginConfigAdapter | undefined {
  return ADAPTERS.get(pluginType);
}

export function listPluginConfigAdapters(): string[] {
  return Array.from(ADAPTERS.keys());
}
