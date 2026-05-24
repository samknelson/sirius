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
