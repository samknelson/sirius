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
 */
export async function fetchPluginManifest<T = unknown>(
  kind: PluginKind,
): Promise<T[]> {
  const res = await fetch(pluginManifestUrl(kind), { credentials: "include" });
  if (!res.ok) {
    throw new Error(`Failed to load ${kind} plugin manifest: ${res.status}`);
  }
  return (await res.json()) as T[];
}
