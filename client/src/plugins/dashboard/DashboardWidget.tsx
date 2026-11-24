import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { normalizeDashboardRefresh, type DashboardRefreshSettings } from "@shared/dashboard-refresh";
import { DashboardConfigContext } from "./useDashboardContent";
import { DashboardRefreshState } from "./refresh-state";
import "./dashboard-widget.css";

function ageLabel(timestamp: number, now: number) {
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds} seconds ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export interface DashboardWidgetProps extends DashboardRefreshSettings {
  configId: string;
  targetUserId?: string | null;
  viewerKey: string;
  name: string;
  children: ReactNode;
}

export function DashboardWidget(props: DashboardWidgetProps) {
  const client = useQueryClient();
  const state = useMemo(() => new DashboardRefreshState(client), [client, props.configId, props.viewerKey, props.targetUserId]);
  useSyncExternalStore(state.subscribe, state.getSnapshot, state.getSnapshot);
  const status = state.read();
  const settings = normalizeDashboardRefresh(props);
  const [now, setNow] = useState(Date.now);
  // This timer updates only the relative label. Fetch scheduling belongs to
  // TanStack Query in the shared hook, not a second wrapper polling loop.
  useEffect(() => {
    if (!settings.autoRefresh) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") setNow(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, [settings.autoRefresh]);
  const context = useMemo(() => ({
    configId: props.configId,
    targetUserId: props.targetUserId ?? null,
    viewerKey: props.viewerKey,
    ...settings,
    refreshState: state,
  }), [props.configId, props.targetUserId, props.viewerKey, settings.autoRefresh, settings.refreshIntervalSeconds, state]);

  return (
    <DashboardConfigContext.Provider value={context}>
      <section className="dashboard-widget min-w-0" aria-label={props.name} data-testid={`dashboard-widget-${props.configId}`}>
        {settings.autoRefresh && (
          <div className="mb-2 flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-xs text-muted-foreground" data-testid="widget-refresh-controls">
            <span title="Time of the last successful content fetch, not the time an underlying scan ran.">
              {status.lastSuccess ? `Last updated ${ageLabel(status.lastSuccess, now)}` : "Not updated yet"}
            </span>
            <Button
              variant="ghost" size="sm"
              disabled={status.fetching || (!status.count && !status.denied)}
              onClick={() => void state.refresh()}
              aria-label={`Refresh ${props.name} now`}
            >
              <RefreshCw aria-hidden="true" className={`mr-2 h-3 w-3 ${status.fetching ? "animate-spin" : ""}`} />
              {status.fetching ? "Refreshing…" : "Refresh now"}
            </Button>
            {status.error && !status.denied && (
              <span role="status" className="w-full text-right text-destructive">
                {status.lastSuccess ? "Refresh failed; showing previously loaded data." : "Could not load widget data. Try Refresh now."}
              </span>
            )}
          </div>
        )}
        {status.denied ? (
          <p role="status" className="rounded-md border p-4 text-sm text-muted-foreground">
            This widget is unavailable or you no longer have access.
          </p>
        ) : props.children}
      </section>
    </DashboardConfigContext.Provider>
  );
}
