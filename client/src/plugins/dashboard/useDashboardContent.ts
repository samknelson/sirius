import { hashKey, useQuery } from "@tanstack/react-query";
import { createContext, useContext, useLayoutEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import type { DashboardRefreshState } from "./refresh-state";
import { normalizeDashboardRefresh } from "@shared/dashboard-refresh";

export type DashboardContentParams = Record<
  string,
  string | number | boolean | undefined | null
>;

/**
 * Identifies which dashboard config row the surrounding widget instance is
 * rendering. The dashboard page wraps each rendered widget in a
 * `DashboardConfigContext.Provider`, so `useDashboardContent` automatically
 * scopes its `/content` read to that specific config (sending `?configId=...`)
 * without each widget having to thread the id through itself. A `null` configId
 * means "unscoped" — the server then falls back to the canonical config.
 *
 * `targetUserId` supports the staff target-view mode (`/users/:id/dashboard`):
 * when set, every `/content` read carries `?targetUserId=` so the server
 * resolves the widget's identity/gating from that user instead of the viewer.
 * `null` (the default) means the normal self-view; requests are unchanged.
 */
export const DashboardConfigContext = createContext<{
  configId: string | null;
  targetUserId?: string | null;
  viewerKey?: string;
  autoRefresh?: boolean;
  refreshIntervalSeconds?: number;
  refreshState?: DashboardRefreshState;
}>({
  configId: null,
  targetUserId: null,
});

export interface UseDashboardContentOptions<TParams extends DashboardContentParams = DashboardContentParams> {
  action?: string;
  params?: TParams;
  enabled?: boolean;
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
  const { action, params, enabled = true } = options;
  const context = useContext(DashboardConfigContext);
  const { configId, targetUserId, refreshState } = context;
  const { user, permissions, components } = useAuth();
  const viewerKey = context.viewerKey ?? JSON.stringify([user?.id, permissions, components]);
  const { autoRefresh, refreshIntervalSeconds } = normalizeDashboardRefresh(context);

  const url = (() => {
    const base = `/api/dashboard-plugins/${pluginId}/content${action ? `/${action}` : ""}`;
    const qs = new URLSearchParams();
    if (configId) qs.append("configId", configId);
    if (targetUserId) qs.append("targetUserId", targetUserId);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null) qs.append(k, String(v));
      }
    }
    const s = qs.toString();
    return s ? `${base}?${s}` : base;
  })();

  const queryKey = [
      "/api/dashboard-plugins",
      pluginId,
      "content",
      action ?? null,
      configId ?? null,
      targetUserId ?? null,
      params ?? null,
      viewerKey,
    ];
  const queryHash = hashKey(queryKey);
  const active = enabled && !!user;
  useLayoutEffect(() => {
    if (active && refreshState) return refreshState.register(queryHash);
  }, [active, refreshState, queryHash]);

  const query = useQuery<TData | null>({
    queryKey,
    queryFn: async ({ signal }) => {
      const res = await fetch(url, { credentials: "include", cache: "no-store", signal });
      if ([401, 403, 404].includes(res.status)) return null;
      if (!res.ok) {
        throw new Error(
          `Failed to load dashboard plugin '${pluginId}' content (${res.status})`,
        );
      }
      return (await res.json()) as TData;
    },
    enabled: active,
    gcTime: 0,
    staleTime: autoRefresh ? 0 : Infinity,
    refetchInterval: autoRefresh ? refreshIntervalSeconds * 1000 : false,
    refetchIntervalInBackground: false,
    refetchOnMount: autoRefresh ? () => document.visibilityState === "visible" ? "always" : false : false,
    refetchOnWindowFocus: autoRefresh ? "always" : false,
    refetchOnReconnect: autoRefresh ? () => document.visibilityState === "visible" ? "always" : false : false,
    retry: false,
  });
  return { ...query, data: active ? query.data ?? undefined : undefined };
}
