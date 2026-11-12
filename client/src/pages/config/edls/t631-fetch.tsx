import { useState } from "react";
import { Link } from "wouter";
import { getApiErrorMessage } from "@/lib/queryClient";
import { useMutation } from "@tanstack/react-query";
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
        description: `${data.workersCreated} workers created, ${data.created} created, ${data.updated} updated, ${data.unchanged} unchanged, ${data.skipped} skipped, ${data.errors} errors; phones: ${data.phonesCreated} created, ${data.phonesDeleted} deleted, ${data.phonesUnchanged} kept, ${data.optins} opt-ins; statuses: ${data.statusesSet} set, EDLS: ${data.edlsActivated} activated, ${data.edlsDeactivated} deactivated`,
        variant: data.errors > 0 ? "destructive" : "default",
      });
    },
    onError: (error: Error) => {
      toast({ title: "Fetch Workers failed", description: getApiErrorMessage(error, "The operation failed."), variant: "destructive" });
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
