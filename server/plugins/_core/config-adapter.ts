import { z } from "zod";
import type { PluginConfigWithSubsidiary } from "../../storage/system/plugin-configs";

/**
 * Per-kind plugin-config adapter (Task #353 — additive foundation).
 *
 * The unified plugin config storage (`storage.pluginConfigs`) is generic: a
 * base `plugin_configs` row plus an optional per-kind subsidiary row. The
 * generic CRUD + search routes in `server/modules/system/plugins-config.ts` know
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
    pluginKind: string;
    pluginId: string;
    enabled?: boolean;
    name?: string | null;
    /**
     * Optional, unique, editable stable identifier. The generic CRUD routes
     * inject this onto the base row from the validated payload, so per-kind
     * adapters do not need to thread it through `toRows`.
     */
    siriusId?: string | null;
    ordering?: number;
    data?: unknown;
  };
  /** Subsidiary columns (without `id`). Omit for kinds with no subsidiary. */
  subsidiary?: Record<string, unknown>;
}

/**
 * Describes one relational (subsidiary) field a kind carries beyond the base
 * envelope. The generic admin UI reads these from the kind's config-meta
 * endpoint and renders a matching input per field, so it can create/edit
 * kinds with relational dimensions (charge scope/employer/account, trust
 * policy/benefit/appliesTo, dispatch jobType) without any kind-specific code.
 * Kinds with no subsidiary (e.g. "dashboard") declare an empty list.
 */
/** A single fixed dropdown choice: the stored value and its visible label. */
export interface PluginConfigEnvelopeFieldChoice {
  value: string;
  label: string;
}

/**
 * Describes the source of dropdown options the generic admin UI uses to render
 * a relational envelope field as a dropdown (Select) instead of a free-text
 * input. Provide EITHER:
 *
 * - a remote source (`endpoint` + `valueKey` + `labelKey`): the UI fetches
 *   `endpoint` (expected to return an array of objects), uses `valueKey` for
 *   each option's stored value and `labelKey` for its label; or
 * - a fixed list (`choices`): a static array of value/label pairs, for fields
 *   backed by a small closed enum (e.g. charge scope = global / employer).
 */
export interface PluginConfigEnvelopeFieldOptions {
  /** GET endpoint returning an array of option objects (e.g. "/api/ledger/accounts"). */
  endpoint?: string;
  /** Property on each option object used as the stored value (e.g. "id"). */
  valueKey?: string;
  /** Property on each option object used as the visible label (e.g. "name"). */
  labelKey?: string;
  /** A fixed list of choices, used instead of a remote endpoint. */
  choices?: PluginConfigEnvelopeFieldChoice[];
}

export interface PluginConfigEnvelopeField {
  /** Column / payload key (e.g. "scope", "employerId", "jobType"). */
  name: string;
  /** Human label for the form control. */
  label: string;
  /** Input type the UI should render. */
  type: "string" | "number";
  /** Whether the field must be provided (non-empty). */
  required?: boolean;
  /**
   * When present, the UI renders this field as a dropdown populated from the
   * given remote data source rather than a plain text input.
   */
  options?: PluginConfigEnvelopeFieldOptions;
  /**
   * When true (only meaningful together with `options.choices`), the UI renders
   * the fixed choices as a checkbox group allowing multiple selections. The
   * stored value is a comma-joined string of the selected choice values (e.g.
   * "start,continue").
   */
  multiple?: boolean;
  /**
   * When true, the generic admin page offers this field as a filter in its
   * filter bar (in addition to the universal Plugin filter). The kind's
   * `searchParamsSchema` and subsidiary `buildConditions` must already accept
   * this field name for the filter to take effect.
   */
  filterable?: boolean;
}

export interface PluginConfigAdapter<TConfig = any, TSearch = any> {
  /** PluginKind discriminator — matches the `:kind` URL segment. */
  pluginKind: string;
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
  /**
   * Relational (subsidiary) fields this kind carries beyond the base
   * envelope. Drives the generic admin UI's per-kind inputs. Omit / empty
   * for kinds with no subsidiary.
   */
  envelopeFields?: PluginConfigEnvelopeField[];
  /**
   * Optional uniqueness key. When present, the generic create/update routes
   * reject a config whose key collides with an existing row (excluding the row
   * being updated). The returned object is a {@link search} filter that selects
   * exactly the conflicting rows (e.g. charge's `{ pluginId, scope, employerId,
   * account }` 4-tuple). Return `null` to skip the check for a given input.
   */
  uniqueKey?(input: TConfig): Record<string, unknown> | null;
  /**
   * Produce the default flat config to seed for a singleton plugin that has no
   * config row yet. Called by the boot-time singleton seeder
   * ({@link bootstrapSingletonPluginConfigs}) once per singleton plugin of this
   * kind, then split via {@link toRows} and inserted. Return `null` to skip
   * seeding a particular plugin. Only meaningful for kinds whose plugins can be
   * singletons (e.g. cron); other kinds omit it.
   */
  seedDefault?(plugin: unknown): TConfig | null;
}

/** Reusable schema shape for the base columns every flat config carries. */
export const baseConfigSchemaShape = {
  pluginId: z.string().min(1),
  name: z.string().nullable().optional(),
  enabled: z.boolean().optional().default(false),
  // Treat a blank/whitespace-only sirius_id as null so it is never used as a
  // DOM element id and multiple unset rows don't collide on the unique index.
  siriusId: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.string().trim().min(1).nullable().optional(),
  ),
  ordering: z.number().int().optional().default(0),
  data: z.unknown().optional().default({}),
};

/** Reusable schema shape for the base search filters every kind accepts. */
export const baseSearchSchemaShape = {
  pluginId: z.string().optional(),
  enabled: z.boolean().optional(),
  siriusId: z.string().optional(),
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
  if (ADAPTERS.has(adapter.pluginKind)) {
    throw new Error(`Plugin config adapter for '${adapter.pluginKind}' already registered`);
  }
  ADAPTERS.set(adapter.pluginKind, adapter);
}

export function getPluginConfigAdapter(pluginKind: string): PluginConfigAdapter | undefined {
  return ADAPTERS.get(pluginKind);
}

export function listPluginConfigAdapters(): string[] {
  return Array.from(ADAPTERS.keys());
}
