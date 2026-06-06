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
 * manifest entries. `client-injection` is intentionally excluded — it
 * has a custom `{ head, bodyEnd }` response shape served by its own
 * route handler and consumed via `<ServerInjections />`.
 */
export type ArrayManifestPluginKind = Exclude<PluginKind, "client-injection">;

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
 * Search plugin configs for a kind via `POST /api/plugins/:kind/configs/search`.
 * Filters are passed in the request body; every field is optional and the
 * server validates them against the kind's adapter `searchParamsSchema`.
 * Returns the hydrated (flat) config envelopes. Throws on non-2xx.
 *
 * `T` types the parsed JSON rows; `P` types the filter params.
 */
export async function pluginSearch<T = unknown, P extends Record<string, unknown> = Record<string, unknown>>(
  kind: ArrayManifestPluginKind,
  params: P = {} as P,
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
