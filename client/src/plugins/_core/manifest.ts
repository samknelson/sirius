/**
 * Stable URL builder + query-key + fetch helper for the unified plugin
 * manifest endpoint (`GET /api/plugins/:kind/manifest`).
 *
 * Every client caller MUST go through these helpers so the URL and
 * query-key shape stay consistent across the codebase.
 */
import type { ResolvedCatalogEntry } from "@shared/catalog";

export type PluginKind = string;

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
 * The client-facing projection of one Plugin Kinds catalog entry.
 */
export interface PluginKindSummary {
  kind: string;
  label: string;
  description?: string;
  requiredComponent?: string;
  configurable: boolean;
}

export function toPluginKindSummaries(
  entries: readonly ResolvedCatalogEntry[],
): PluginKindSummary[] {
  return entries.map((entry) => ({
    kind: entry.id,
    label: entry.name,
    ...(entry.description !== undefined ? { description: entry.description } : {}),
    ...(entry.component !== undefined ? { requiredComponent: entry.component } : {}),
    configurable: entry.detail?.configurable === true,
  }));
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
  /**
   * The selected plugin cannot accept this choice (the save route would
   * reject it), so the admin form shows it but won't let it be switched on.
   * Only appears on the per-plugin envelope fields served by the meta
   * endpoint's `pluginEnvelopeFields`.
   */
  disabled?: boolean;
  /** Short human explanation shown beside a disabled choice. */
  disabledReason?: string;
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
  /** Safe guidance shown beside the form control. */
  description?: string;
  /** Safe placeholder-only example rendered as structured text. */
  example?: string;
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

/**
 * Search plugin configs for a kind via `POST /api/plugins/:kind/configs/search`.
 * Filters are passed in the request body; every field is optional and the
 * server validates them against the kind's adapter `searchParamsSchema`.
 * Returns the hydrated (flat) config envelopes. Throws on non-2xx.
 *
 * The server-owned config adapter validates the filter fields for the selected
 * kind. `T` types the parsed rows.
 */
export async function pluginSearch<T = unknown>(
  kind: string,
  params: Record<string, unknown> = {},
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
