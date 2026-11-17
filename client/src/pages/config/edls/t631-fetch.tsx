import { useEffect, useState } from "react";
import { Link } from "wouter";
import { getApiErrorMessage } from "@/lib/queryClient";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { Loader2, RefreshCw, Eye, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

interface WorkerEinSyncResult {
  dryRun: boolean;
  created: number;
  updated: number;
  deleted: number;
  unchanged: number;
  skipped: number;
  errors: number;
  workersCreated: number;
  phonesCreated: number;
  phonesDeleted: number;
  phonesUnchanged: number;
  optins: number;
  statusesSet: number;
  edlsActivated: number;
  edlsDeactivated: number;
  details: Array<{ workerId?: string; remoteWorkerId: string; action: string; error?: string }>;
}

export default function T631FetchPage() {
  usePageTitle("Teamsters 631 Sync");
  const { toast } = useToast();
  const { user } = useAuth();
  const [runId, setRunId] = useState<string | null>(null);
  type Run = { id: string; status: string; dryRun: boolean; error: string | null; result: WorkerEinSyncResult | null };
  const readRun = async (id?: string): Promise<Run | null> => {
    const res = await fetch(`/api/sitespecific/t631/client/sync-workers/runs${id ? `/${encodeURIComponent(id)}` : ""}`, {
      credentials: "include", cache: "no-store",
    });
    if (!res.ok) throw new Error("Could not read sync status");
    return res.json();
  };
  const discovery = useQuery({
    queryKey: ["t631-sync-discovery", user?.id],
    queryFn: () => readRun(),
    refetchInterval: 2000,
    staleTime: 0,
  });
  useEffect(() => {
    if (discovery.data && (!runId || discovery.data.status === "running")) setRunId(discovery.data.id);
  }, [discovery.data, runId]);
  const status = useQuery({
    queryKey: ["t631-sync-run", user?.id, runId],
    queryFn: () => readRun(runId!),
    enabled: !!runId,
    refetchInterval: query => !query.state.data || query.state.data.status === "running" ? 2000 : false,
  });
  const run = status.data;
  const syncResult = run?.status === "success" ? run.result : null;
  const active = run?.status === "running" || discovery.data?.status === "running";
  const statusUnknown = discovery.isPending || discovery.isError || (!!runId && (status.isPending || status.isError));

  const syncMutation = useMutation({
    retry: false,
    mutationFn: async (dryRun: boolean) => {
      const res = await fetch("/api/sitespecific/t631/client/sync-workers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun }),
        credentials: "include",
      });
      const body = await res.json().catch(() => ({ message: "Request failed" }));
      if (!res.ok && !(res.status === 409 && body.runId)) {
        throw new Error(body.message || `HTTP ${res.status}`);
      }
      return body as { runId: string; duplicate?: boolean };
    },
    onSuccess: (data) => {
      setRunId(data.runId);
      void discovery.refetch();
      toast({ title: data.duplicate ? "Monitoring the active sync" : "Sync accepted" });
    },
    onError: (error: Error) => {
      void discovery.refetch();
      toast({ title: "Start was not confirmed", description: `${getApiErrorMessage(error, "The request could not be confirmed.")} Checking existing runs; the start request will not be retried automatically.`, variant: "destructive" });
    },
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <RefreshCw className="h-5 w-5" />
            Teamsters 631 Worker Sync
          </CardTitle>
          <CardDescription>
            Preview or apply worker imports and synchronization from Teamsters 631.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            For connection tests and one-request T631 diagnostics, use{" "}
            <Button variant="link" className="h-auto p-0 align-baseline" asChild>
              <Link href="/admin/wc/overview">
                Outgoing Web Services
                <ExternalLink className="ml-1 h-3.5 w-3.5" />
              </Link>
            </Button>
            .
          </p>
        </CardContent>
      </Card>

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
                onClick={() => syncMutation.mutate(true)}
                disabled={syncMutation.isPending || active || statusUnknown}
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
                onClick={() => syncMutation.mutate(false)}
                disabled={syncMutation.isPending || active || statusUnknown}
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
            {statusUnknown && <p role="status" className="text-sm text-muted-foreground">
              {discovery.isError || status.isError
                ? "Status is temporarily unavailable. This does not mean the sync failed. Reconnecting automatically; no new sync will be started."
                : "Checking sync status…"}
            </p>}
            {run && <div role="status" className="space-y-2 text-sm">
              <p><Badge variant="outline">{run.dryRun ? "Dry Run" : "Live Run"}</Badge>{" "}
                {run.status === "running" ? "Running — you can leave this page and return." :
                  run.status === "success" ? "Complete" : run.status === "interrupted" ? "Interrupted" : "Failed"}
              </p>
              <p className="text-xs text-muted-foreground">Run: {run.id}</p>
              {run.error && <p role="alert" className="text-destructive">{run.error}</p>}
            </div>}
            <p className="text-xs text-muted-foreground">
              Active status refreshes every two seconds. The remote service still has its own timeout.
            </p>

            {syncResult && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={syncResult.dryRun ? "outline" : "default"} data-testid="badge-sync-mode">
                    {syncResult.dryRun ? "Dry Run" : "Live Run"}
                  </Badge>
                  <Badge variant="secondary" data-testid="badge-sync-workers-created">{syncResult.workersCreated} workers created</Badge>
                  <Badge variant="secondary" data-testid="badge-sync-created">{syncResult.created} created</Badge>
                  <Badge variant="secondary" data-testid="badge-sync-updated">{syncResult.updated} updated</Badge>
                  <Badge variant="secondary" data-testid="badge-sync-deleted">{syncResult.deleted} IDs deleted</Badge>
                  <Badge variant="secondary" data-testid="badge-sync-unchanged">{syncResult.unchanged} unchanged</Badge>
                  <Badge variant="secondary" data-testid="badge-sync-skipped">{syncResult.skipped} skipped</Badge>
                  <Badge variant={syncResult.errors > 0 ? "destructive" : "secondary"} data-testid="badge-sync-errors">
                    {syncResult.errors} errors
                  </Badge>
                  <Badge variant="secondary" data-testid="badge-sync-phones-created">{syncResult.phonesCreated} phones created</Badge>
                  <Badge variant="secondary" data-testid="badge-sync-phones-deleted">{syncResult.phonesDeleted} phones deleted</Badge>
                  <Badge variant="secondary" data-testid="badge-sync-phones-kept">{syncResult.phonesUnchanged} phones kept</Badge>
                  <Badge variant="secondary" data-testid="badge-sync-optins">{syncResult.optins} SMS opt-ins</Badge>
                  <Badge variant="secondary" data-testid="badge-sync-statuses-set">{syncResult.statusesSet} statuses set</Badge>
                  <Badge variant="secondary" data-testid="badge-sync-edls-activated">{syncResult.edlsActivated} EDLS activated</Badge>
                  <Badge variant="secondary" data-testid="badge-sync-edls-deactivated">{syncResult.edlsDeactivated} EDLS deactivated</Badge>
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
    </div>
  );
}
