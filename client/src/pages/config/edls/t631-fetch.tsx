import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { Play, Loader2, CheckCircle2, XCircle, Clock, Zap, Send, ArrowDownToLine, RefreshCw, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

interface RequestDiagnostics {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown[];
}

interface ResponseDiagnostics {
  status: number;
  statusText: string;
  headers: Record<string, string>;
}

interface FetchResult {
  success: boolean;
  action: string;
  request: RequestDiagnostics;
  response?: ResponseDiagnostics;
  data?: unknown;
  rawBody?: string;
  error?: string;
  timestamp: string;
  durationMs: number;
}

const ACTIONS = [
  { value: "sirius_service_ping", label: "Ping", description: "Test connectivity to the T631 server" },
  { value: "sirius_edls_server_worker_list", label: "Worker List", description: "Fetch the list of workers from the T631 server" },
  { value: "sirius_dispatch_group_search", label: "Dispatch Group Search", description: "Search dispatch groups on the T631 server" },
  { value: "sirius_dispatch_facility_dropdown", label: "Facility Dropdown", description: "Fetch the facility dropdown list from the T631 server" },
  { value: "sirius_edls_server_tos_list", label: "TOs List", description: "Fetch the list of absences (TOs) from the T631 server" },
];

interface WorkerEinSyncResult {
  dryRun: boolean;
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  errors: number;
  workersCreated: number;
  phonesCreated: number;
  phonesDeleted: number;
  phonesUnchanged: number;
  optins: number;
  details: Array<{ workerId?: string; remoteWorkerId: string; action: string; error?: string }>;
}

export default function T631FetchPage() {
  usePageTitle("Teamsters 631 Fetch");
  const { toast } = useToast();
  const [action, setAction] = useState("sirius_service_ping");
  const [result, setResult] = useState<FetchResult | null>(null);
  const [syncResult, setSyncResult] = useState<WorkerEinSyncResult | null>(null);

  const syncMutation = useMutation({
    mutationFn: async (dryRun: boolean) => {
      const res = await fetch("/api/sitespecific/t631/client/sync-workers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun }),
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ message: "Request failed" }));
        throw new Error(body.message || `HTTP ${res.status}`);
      }
      return res.json() as Promise<WorkerEinSyncResult>;
    },
    onSuccess: (data) => {
      setSyncResult(data);
      toast({
        title: data.dryRun ? "Dry run complete" : "Fetch Workers complete",
        description: `${data.workersCreated} workers created, ${data.created} created, ${data.updated} updated, ${data.unchanged} unchanged, ${data.skipped} skipped, ${data.errors} errors; phones: ${data.phonesCreated} created, ${data.phonesDeleted} deleted, ${data.phonesUnchanged} kept, ${data.optins} opt-ins`,
        variant: data.errors > 0 ? "destructive" : "default",
      });
    },
    onError: (error: Error) => {
      toast({ title: "Fetch Workers failed", description: error.message, variant: "destructive" });
    },
  });

  const fetchMutation = useMutation({
    mutationFn: async (selectedAction: string) => {
      const res = await fetch("/api/sitespecific/t631/client/fetch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: selectedAction }),
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ message: "Request failed" }));
        throw new Error(body.message || `HTTP ${res.status}`);
      }
      return res.json() as Promise<FetchResult>;
    },
    onSuccess: (data) => {
      setResult(data);
      if (data.success) {
        toast({ title: "Fetch complete", description: `${data.action} succeeded in ${data.durationMs}ms` });
      } else {
        toast({ title: "Fetch failed", description: data.error || "Unknown error", variant: "destructive" });
      }
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleRun = () => {
    setResult(null);
    fetchMutation.mutate(action);
  };

  const selectedAction = ACTIONS.find((a) => a.value === action);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5" />
            Teamsters 631 Fetch
          </CardTitle>
          <CardDescription>
            Test connectivity and fetch data from the Teamsters 631 server.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-end gap-4">
            <div className="space-y-2 flex-1 max-w-sm">
              <Label htmlFor="action-select">Action</Label>
              <Select value={action} onValueChange={setAction}>
                <SelectTrigger id="action-select" data-testid="select-action">
                  <SelectValue placeholder="Select action" />
                </SelectTrigger>
                <SelectContent>
                  {ACTIONS.map((a) => (
                    <SelectItem key={a.value} value={a.value} data-testid={`select-action-${a.value}`}>
                      {a.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              onClick={handleRun}
              disabled={fetchMutation.isPending}
              data-testid="button-run-fetch"
            >
              {fetchMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Play className="mr-2 h-4 w-4" />
              )}
              Run
            </Button>
          </div>

          {selectedAction && (
            <p className="text-sm text-muted-foreground">
              {selectedAction.description}
            </p>
          )}
        </CardContent>
      </Card>

      {action === "sirius_edls_server_worker_list" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <RefreshCw className="h-4 w-4" />
              Fetch Workers
            </CardTitle>
            <CardDescription>
              Match remote workers by their Teamsters 631 worker ID and store each worker's EIN
              under the "freeman_ein" worker ID type. Workers not found locally are created from
              the remote name; rows without an EIN use the remote worker ID as the EIN.
              Dry run previews changes without writing.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={() => { setSyncResult(null); syncMutation.mutate(true); }}
                disabled={syncMutation.isPending}
                data-testid="button-sync-workers-dry-run"
              >
                {syncMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Eye className="mr-2 h-4 w-4" />
                )}
                Dry Run
              </Button>
              <Button
                onClick={() => { setSyncResult(null); syncMutation.mutate(false); }}
                disabled={syncMutation.isPending}
                data-testid="button-sync-workers"
              >
                {syncMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
                )}
                Fetch Workers
              </Button>
            </div>

            {syncResult && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={syncResult.dryRun ? "outline" : "default"} data-testid="badge-sync-mode">
                    {syncResult.dryRun ? "Dry Run" : "Live Run"}
                  </Badge>
                  <Badge variant="secondary" data-testid="badge-sync-workers-created">{syncResult.workersCreated} workers created</Badge>
                  <Badge variant="secondary" data-testid="badge-sync-created">{syncResult.created} created</Badge>
                  <Badge variant="secondary" data-testid="badge-sync-updated">{syncResult.updated} updated</Badge>
                  <Badge variant="secondary" data-testid="badge-sync-unchanged">{syncResult.unchanged} unchanged</Badge>
                  <Badge variant="secondary" data-testid="badge-sync-skipped">{syncResult.skipped} skipped</Badge>
                  <Badge variant={syncResult.errors > 0 ? "destructive" : "secondary"} data-testid="badge-sync-errors">
                    {syncResult.errors} errors
                  </Badge>
                  <Badge variant="secondary" data-testid="badge-sync-phones-created">{syncResult.phonesCreated} phones created</Badge>
                  <Badge variant="secondary" data-testid="badge-sync-phones-deleted">{syncResult.phonesDeleted} phones deleted</Badge>
                  <Badge variant="secondary" data-testid="badge-sync-phones-kept">{syncResult.phonesUnchanged} phones kept</Badge>
                  <Badge variant="secondary" data-testid="badge-sync-optins">{syncResult.optins} SMS opt-ins</Badge>
                </div>
                {syncResult.details.length > 0 && (
                  <div>
                    <Label className="text-xs text-muted-foreground">Details</Label>
                    <pre
                      className="rounded-md bg-muted p-3 text-xs overflow-auto max-h-96"
                      data-testid="text-sync-details"
                    >
                      {JSON.stringify(syncResult.details, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {result && (
        <>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                {result.success ? (
                  <CheckCircle2 className="h-5 w-5 text-green-600" />
                ) : (
                  <XCircle className="h-5 w-5 text-red-600" />
                )}
                Result
                <Badge variant={result.success ? "default" : "destructive"} data-testid="badge-result-status">
                  {result.success ? "Success" : "Failed"}
                </Badge>
                {result.response && (
                  <Badge variant="outline" data-testid="badge-http-status">
                    HTTP {result.response.status}
                  </Badge>
                )}
              </CardTitle>
              <CardDescription className="flex items-center gap-4">
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {result.durationMs}ms
                </span>
                <span>{result.timestamp}</span>
              </CardDescription>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-medium">
                <Send className="h-4 w-4" />
                Request
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label className="text-xs text-muted-foreground">URL</Label>
                <pre className="rounded-md bg-muted p-2 text-xs overflow-auto" data-testid="text-request-url">
                  {result.request.method} {result.request.url}
                </pre>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Headers</Label>
                <pre className="rounded-md bg-muted p-2 text-xs overflow-auto" data-testid="text-request-headers">
                  {Object.entries(result.request.headers).map(([k, v]) => `${k}: ${v}`).join("\n")}
                </pre>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Body</Label>
                <pre className="rounded-md bg-muted p-2 text-xs overflow-auto" data-testid="text-request-body">
                  {JSON.stringify(result.request.body, null, 2)}
                </pre>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-medium">
                <ArrowDownToLine className="h-4 w-4" />
                Response
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {result.error && !result.response && (
                <div className="text-sm text-red-600 dark:text-red-400" data-testid="text-error">
                  {result.error}
                </div>
              )}

              {result.response && (
                <>
                  <div>
                    <Label className="text-xs text-muted-foreground">Status</Label>
                    <pre className="rounded-md bg-muted p-2 text-xs overflow-auto" data-testid="text-response-status">
                      {result.response.status} {result.response.statusText}
                    </pre>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Headers</Label>
                    <pre className="rounded-md bg-muted p-2 text-xs overflow-auto max-h-40" data-testid="text-response-headers">
                      {Object.entries(result.response.headers).map(([k, v]) => `${k}: ${v}`).join("\n")}
                    </pre>
                  </div>
                </>
              )}

              {result.data !== undefined && (
                <div>
                  <Label className="text-xs text-muted-foreground">Body (JSON)</Label>
                  <pre
                    className="rounded-md bg-muted p-3 text-xs overflow-auto max-h-96"
                    data-testid="text-response-data"
                  >
                    {JSON.stringify(result.data, null, 2)}
                  </pre>
                </div>
              )}

              {result.rawBody !== undefined && (
                <div>
                  <Label className="text-xs text-muted-foreground">Body (Raw — not valid JSON)</Label>
                  <pre
                    className="rounded-md bg-muted p-3 text-xs overflow-auto max-h-96 text-red-600 dark:text-red-400"
                    data-testid="text-response-raw"
                  >
                    {result.rawBody || "(empty)"}
                  </pre>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
