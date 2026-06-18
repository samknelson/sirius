import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Info, RefreshCw, Trash2 } from "lucide-react";
import { usePageTitle } from "@/contexts/PageTitleContext";

interface HandlerInfo {
  id: string;
  name: string;
  description: string;
}

interface CatalogResponse {
  eventTypes: string[];
  handlers: Record<string, HandlerInfo[]>;
  handlerCounts: Record<string, number>;
  ringBufferCap: number;
  excludedFromBuffer: string[];
}

interface RecentEmitFailure {
  handlerId: string;
  handlerName: string;
  message: string;
}

interface RecentEmitEntry {
  emittedAt: string;
  eventType: string;
  payload: unknown;
  payloadTruncated: boolean;
  handlerCount: number;
  successCount: number;
  failureCount: number;
  durationMs: number;
  failures: RecentEmitFailure[];
}

interface RecentResponse {
  entries: RecentEmitEntry[];
}

const ALL = "__all__";

export default function EventBusDebugPage() {
  usePageTitle("Event Bus");
  const [filterEventType, setFilterEventType] = useState<string>(ALL);

  const catalogQuery = useQuery<CatalogResponse>({
    queryKey: ["/api/admin/debug/event-bus/catalog"],
    staleTime: 5_000,
  });

  const recentQuery = useQuery<RecentResponse>({
    queryKey: [
      "/api/admin/debug/event-bus/recent",
      filterEventType === ALL ? null : filterEventType,
    ],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filterEventType !== ALL) params.set("eventType", filterEventType);
      params.set("limit", "200");
      const res = await fetch(`/api/admin/debug/event-bus/recent?${params.toString()}`);
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      return res.json();
    },
    staleTime: 5_000,
  });

  const clearMutation = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/admin/debug/event-bus/clear"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/debug/event-bus/recent"] });
    },
  });

  const catalog = catalogQuery.data;
  const recent = recentQuery.data?.entries || [];

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-event-bus-title">Event Bus</h1>
          <p className="text-sm text-muted-foreground">
            Introspect registered event handlers and recent emits.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            queryClient.invalidateQueries({ queryKey: ["/api/admin/debug/event-bus/catalog"] });
            queryClient.invalidateQueries({ queryKey: ["/api/admin/debug/event-bus/recent"] });
          }}
          data-testid="button-refresh"
        >
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle>In-memory only</AlertTitle>
        <AlertDescription>
          History is in-memory and resets when the server restarts. The ring buffer holds up to{" "}
          {catalog?.ringBufferCap ?? 100} entries per event type. The{" "}
          <code className="font-mono">log</code> event is excluded to avoid feedback loops.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>Event types</CardTitle>
          <CardDescription>Sourced from the EventType enum.</CardDescription>
        </CardHeader>
        <CardContent>
          {catalogQuery.isLoading && <div>Loading…</div>}
          {catalog && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {catalog.eventTypes.map((et) => (
                <div
                  key={et}
                  className="flex items-center justify-between border rounded-md px-3 py-2"
                  data-testid={`row-event-type-${et}`}
                >
                  <span className="font-mono text-sm">{et}</span>
                  <Badge variant="secondary" data-testid={`badge-handler-count-${et}`}>
                    {catalog.handlerCounts[et] ?? 0} handler
                    {catalog.handlerCounts[et] === 1 ? "" : "s"}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Handlers</CardTitle>
          <CardDescription>Grouped by event type.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {catalog &&
            catalog.eventTypes.map((et) => {
              const handlers = catalog.handlers[et] || [];
              if (handlers.length === 0) return null;
              return (
                <div key={et} data-testid={`group-handlers-${et}`}>
                  <h3 className="font-mono text-sm mb-2">{et}</h3>
                  <div className="space-y-2">
                    {handlers.map((h) => (
                      <div
                        key={h.id}
                        className="border rounded-md p-3"
                        data-testid={`row-handler-${h.id}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium" data-testid={`text-handler-name-${h.id}`}>
                            {h.name}
                          </span>
                          <Badge variant="outline" className="font-mono text-xs">
                            {h.id}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">{h.description}</p>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          {catalog &&
            catalog.eventTypes.every((et) => (catalog.handlers[et] || []).length === 0) && (
              <div className="text-sm text-muted-foreground">No handlers registered.</div>
            )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <CardTitle>Recent emits</CardTitle>
              <CardDescription>Most recent first. In-memory only.</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Select value={filterEventType} onValueChange={setFilterEventType}>
                <SelectTrigger className="w-[240px]" data-testid="select-filter-event-type">
                  <SelectValue placeholder="Filter by event type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All event types</SelectItem>
                  {catalog?.eventTypes.map((et) => (
                    <SelectItem key={et} value={et}>
                      {et}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="destructive"
                onClick={() => clearMutation.mutate()}
                disabled={clearMutation.isPending}
                data-testid="button-clear-buffer"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Clear buffer
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {recentQuery.isLoading && <div>Loading…</div>}
          {recent.length === 0 && !recentQuery.isLoading && (
            <div className="text-sm text-muted-foreground">No recent emits.</div>
          )}
          <div className="space-y-2">
            {recent.map((entry, idx) => (
              <div
                key={`${entry.emittedAt}-${idx}`}
                className="border rounded-md p-3 space-y-2"
                data-testid={`row-emit-${idx}`}
              >
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm">{entry.eventType}</span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(entry.emittedAt).toLocaleString()}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{entry.handlerCount} handlers</Badge>
                    <Badge variant="outline">{entry.successCount} ok</Badge>
                    {entry.failureCount > 0 && (
                      <Badge variant="destructive">{entry.failureCount} failed</Badge>
                    )}
                    <Badge variant="outline">{entry.durationMs} ms</Badge>
                  </div>
                </div>
                <pre className="text-xs bg-muted rounded p-2 overflow-x-auto max-h-48">
                  {JSON.stringify(entry.payload, null, 2)}
                </pre>
                {entry.payloadTruncated && (
                  <p className="text-xs text-muted-foreground">Payload was truncated.</p>
                )}
                {entry.failures.length > 0 && (
                  <div className="space-y-1">
                    {entry.failures.map((f, fi) => (
                      <div
                        key={fi}
                        className="text-xs border border-destructive/30 rounded p-2 bg-destructive/5"
                      >
                        <span className="font-medium">{f.handlerName}</span>
                        <span className="text-muted-foreground"> ({f.handlerId})</span>: {f.message}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
