import { useQuery } from "@tanstack/react-query";

export type DashboardContentParams = Record<
  string,
  string | number | boolean | undefined | null
>;

export interface UseDashboardContentOptions<TParams extends DashboardContentParams = DashboardContentParams> {
  action?: string;
  params?: TParams;
  enabled?: boolean;
  refetchIntervalMs?: number;
}

/**
 * Single front-door for reading data into a dashboard widget. Always hits
 * `GET /api/dashboard-plugins/:pluginId/content[/:action]`, which is the
 * authoritative point where the server enforces component + access-policy
 * gating. Widgets should NOT re-check permissions or components on the
 * client; if the user isn't allowed, the API returns 403/404 and the hook
 * resolves to `undefined`.
 *
 * Query key shape: `["/api/dashboard-plugins", pluginId, "content", action|null, params|null]`
 * so mutations can target invalidation precisely.
 */
export function useDashboardContent<
  TData,
  TParams extends DashboardContentParams = DashboardContentParams,
>(pluginId: string, options: UseDashboardContentOptions<TParams> = {}) {
  const { action, params, enabled = true, refetchIntervalMs } = options;

  const url = (() => {
    const base = `/api/dashboard-plugins/${pluginId}/content${action ? `/${action}` : ""}`;
    if (!params) return base;
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) qs.append(k, String(v));
    }
    const s = qs.toString();
    return s ? `${base}?${s}` : base;
  })();

  return useQuery<TData | undefined>({
    queryKey: [
      "/api/dashboard-plugins",
      pluginId,
      "content",
      action ?? null,
      params ?? null,
    ],
    queryFn: async () => {
      const res = await fetch(url, { credentials: "include" });
      if (res.status === 403 || res.status === 404) return undefined;
      if (!res.ok) {
        throw new Error(
          `Failed to load dashboard plugin '${pluginId}' content (${res.status})`,
        );
      }
      return (await res.json()) as TData;
    },
    enabled,
    refetchInterval: refetchIntervalMs,
  });
}
