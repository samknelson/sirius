/**
 * Stable URL builder + query-key + fetch helper for the unified plugin
 * manifest endpoint (`GET /api/plugins/:kind/manifest`).
 *
 * Every client caller MUST go through these helpers so the URL and
 * query-key shape stay consistent across the codebase.
 */
export type PluginKind =
  | "dashboard"
  | "dispatch-eligibility"
  | "charge"
  | "trust-eligibility"
  | "client-injection";

/**
 * Kinds whose `/api/plugins/:kind/manifest` returns a flat array of
 * manifest entries. Every kind now returns an array here, including
 * `client-injection` (its admin manifest lists the registered injection
 * impls). The fully-resolved `{ head, bodyEnd }` injection payload lives at
 * the separate `/api/plugins/client-injection/resolved` endpoint, consumed
 * via `<ServerInjections />`.
 */
export type ArrayManifestPluginKind = PluginKind;

/**
 * One configurable plugin kind as returned by `GET /api/plugins/kinds`.
 * The server owns the list (and the human-readable label) so the client
 * never duplicates the set of kinds. Drives the admin index page at
 * `/admin/plugin-configs`.
 */
export interface PluginKindSummary {
  kind: ArrayManifestPluginKind;
  label: string;
}

/** Stable URL + query-key for the configurable-kinds index endpoint. */
export function pluginKindsUrl(): string {
  return "/api/plugins/kinds";
}

export function pluginKindsQueryKey(): readonly unknown[] {
  return [pluginKindsUrl()];
}

export function pluginManifestUrl(kind: PluginKind): string {
  return `/api/plugins/${kind}/manifest`;
}

export function pluginManifestQueryKey(kind: PluginKind): readonly unknown[] {
  return [pluginManifestUrl(kind)];
}

/**
 * Fetch and parse a plugin manifest. Throws on non-2xx. Use this as
 * the `queryFn` in TanStack Query callers (or call it directly from
 * an effect). The kind's expected payload shape is the caller's
 * responsibility — pass `T` to type the parsed JSON.
 *
 * Only kinds that return a flat array are accepted here. The
 * `client-injection` kind has a `{ head, bodyEnd }` response shape and
 * must be fetched via `<ServerInjections />` instead.
 */
export async function fetchPluginManifest<T = unknown>(
  kind: ArrayManifestPluginKind,
): Promise<T[]> {
  const res = await fetch(pluginManifestUrl(kind), { credentials: "include" });
  if (!res.ok) {
    throw new Error(`Failed to load ${kind} plugin manifest: ${res.status}`);
  }
  return (await res.json()) as T[];
}

/**
 * Stable URL + query-key for the generic plugin config CRUD endpoints
 * (`/api/plugins/:kind/configs`, Task #353). Every client caller MUST go
 * through these so the URL and cache-key shape stay consistent.
 */
export function pluginConfigsUrl(kind: ArrayManifestPluginKind): string {
  return `/api/plugins/${kind}/configs`;
}

export function pluginConfigsQueryKey(
  kind: ArrayManifestPluginKind,
): readonly unknown[] {
  return [pluginConfigsUrl(kind)];
}

/**
 * A relational (subsidiary) field a kind carries beyond the base envelope.
 * Mirrors the server `PluginConfigEnvelopeField` and is served by
 * `GET /api/plugins/:kind/configs/meta`. The generic admin UI renders one
 * input per field and includes them in create/update payloads.
 */
/** A single fixed dropdown choice: the stored value and its visible label. */
export interface PluginConfigEnvelopeFieldChoice {
  value: string;
  label: string;
}

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
  name: string;
  label: string;
  type: "string" | "number";
  required?: boolean;
  /** When present, render this field as a dropdown populated from this source. */
  options?: PluginConfigEnvelopeFieldOptions;
  /**
   * When true (with `options.choices`), render the choices as a checkbox group
   * allowing multiple selections. The stored value is a comma-joined string of
   * the selected choice values (e.g. "start,continue").
   */
  multiple?: boolean;
  /**
   * When true, the generic admin page offers this field as a filter in its
   * filter bar (alongside the universal Plugin filter).
   */
  filterable?: boolean;
}

/** Stable URL + query-key for the per-kind config metadata endpoint. */
export function pluginConfigsMetaUrl(kind: ArrayManifestPluginKind): string {
  return `${pluginConfigsUrl(kind)}/meta`;
}

export function pluginConfigsMetaQueryKey(
  kind: ArrayManifestPluginKind,
): readonly unknown[] {
  return [pluginConfigsMetaUrl(kind)];
}

/** Base search filters every kind accepts (mirrors `baseSearchSchemaShape`). */
export interface BasePluginSearchParams {
  pluginId?: string;
  enabled?: boolean;
}

/**
 * Per-kind search-param shapes. Each entry mirrors the kind's adapter
 * `searchParamsSchema` on the server, so a caller passing the wrong filter
 * for a kind fails at compile time. Keep this in lockstep with the adapters
 * registered in `server/plugins/**` (Task #353).
 */
export interface PluginSearchParamsByKind {
  dashboard: BasePluginSearchParams;
  "dispatch-eligibility": BasePluginSearchParams & { jobType?: string | null };
  charge: BasePluginSearchParams & {
    scope?: string;
    employerId?: string | null;
    account?: string | null;
  };
  "trust-eligibility": BasePluginSearchParams & {
    policy?: string | null;
    benefit?: string | null;
    appliesTo?: string | null;
  };
  "client-injection": BasePluginSearchParams;
}

/**
 * Search plugin configs for a kind via `POST /api/plugins/:kind/configs/search`.
 * Filters are passed in the request body; every field is optional and the
 * server validates them against the kind's adapter `searchParamsSchema`.
 * Returns the hydrated (flat) config envelopes. Throws on non-2xx.
 *
 * `K` is the plugin kind, which selects the allowed filter shape from
 * {@link PluginSearchParamsByKind} at compile time; `T` types the parsed rows.
 */
export async function pluginSearch<
  K extends keyof PluginSearchParamsByKind,
  T = unknown,
>(
  kind: K,
  params: PluginSearchParamsByKind[K] = {} as PluginSearchParamsByKind[K],
): Promise<T[]> {
  const res = await fetch(`${pluginConfigsUrl(kind)}/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    throw new Error(`Failed to search ${kind} plugin configs: ${res.status}`);
  }
  return (await res.json()) as T[];
}
