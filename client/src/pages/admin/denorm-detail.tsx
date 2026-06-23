import { useState } from "react";
import { Link, useParams } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Loader2,
  ArrowLeft,
  Trash2,
  RefreshCw,
  PlayCircle,
  ExternalLink,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface DenormStatusCounts {
  ok: number;
  stale: number;
  error: number;
  total: number;
}

interface DenormConfigDetail {
  id: string;
  pluginId: string;
  name: string | null;
  pluginName: string;
  enabled: boolean;
  counts: DenormStatusCounts;
}

interface DenormBackfillSummary {
  mode: "live" | "test";
  totalEnqueued: number;
  totalDeleted: number;
}

interface DenormRecomputeSummary {
  mode: "live" | "test";
  totalRecomputed: number;
  totalErrored: number;
}

function StatCard({
  label,
  value,
  tone,
  testId,
}: {
  label: string;
  value: number;
  tone: "ok" | "stale" | "error" | "total";
  testId: string;
}) {
  const toneClass = {
    ok: "text-green-600 dark:text-green-400",
    stale: "text-amber-600 dark:text-amber-400",
    error: "text-red-600 dark:text-red-400",
    total: "text-foreground",
  }[tone];

  return (
    <Card data-testid={`card-${testId}`}>
      <CardContent className="pt-6">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p
          className={`text-3xl font-bold tabular-nums ${toneClass}`}
          data-testid={`text-${testId}`}
        >
          {value}
        </p>
      </CardContent>
    </Card>
  );
}

export default function DenormConfigDetailPage() {
  const params = useParams<{ plugin_config_id: string }>();
  const configId = params.plugin_config_id;
  const { toast } = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const { data: config, isLoading, isError } = useQuery<DenormConfigDetail>({
    queryKey: ["/api/denorm/configs", configId],
    enabled: !!configId,
  });

  function invalidateCounts() {
    queryClient.invalidateQueries({
      queryKey: ["/api/denorm/configs", configId],
    });
    queryClient.invalidateQueries({ queryKey: ["/api/denorm/configs"] });
  }

  const clearMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", `/api/denorm/configs/${configId}/clear`);
    },
    onSuccess: (result: { deleted: number }) => {
      setConfirmOpen(false);
      invalidateCounts();
      toast({
        title: "Records cleared",
        description: `Deleted ${result.deleted} record${
          result.deleted === 1 ? "" : "s"
        }. The backfill sweep will rebuild them.`,
      });
    },
    onError: () => {
      toast({
        title: "Failed to clear records",
        description: "Something went wrong while clearing this denorm config.",
        variant: "destructive",
      });
    },
  });

  const backfillMutation = useMutation({
    mutationFn: async (mode: "live" | "test") => {
      return apiRequest("POST", `/api/denorm/configs/${configId}/backfill`, {
        mode,
      }) as Promise<DenormBackfillSummary>;
    },
    onSuccess: (result) => {
      invalidateCounts();
      const dryRun = result.mode === "test";
      toast({
        title: dryRun ? "Backfill preview" : "Backfill complete",
        description: dryRun
          ? `Would enqueue ${result.totalEnqueued} new record${
              result.totalEnqueued === 1 ? "" : "s"
            } and delete ${result.totalDeleted} stray record${
              result.totalDeleted === 1 ? "" : "s"
            }. Nothing was changed.`
          : `Enqueued ${result.totalEnqueued} new record${
              result.totalEnqueued === 1 ? "" : "s"
            } as stale and deleted ${result.totalDeleted} stray record${
              result.totalDeleted === 1 ? "" : "s"
            }.`,
      });
    },
    onError: () => {
      toast({
        title: "Failed to run backfill",
        description: "Something went wrong while running the backfill.",
        variant: "destructive",
      });
    },
  });

  const recomputeMutation = useMutation({
    mutationFn: async (mode: "live" | "test") => {
      return apiRequest("POST", `/api/denorm/configs/${configId}/recompute`, {
        mode,
      }) as Promise<DenormRecomputeSummary>;
    },
    onSuccess: (result) => {
      invalidateCounts();
      const dryRun = result.mode === "test";
      toast({
        title: dryRun ? "Recompute preview" : "Recompute complete",
        description: dryRun
          ? `Would recompute ${result.totalRecomputed} stale record${
              result.totalRecomputed === 1 ? "" : "s"
            }. Nothing was changed.`
          : `Recomputed ${result.totalRecomputed} record${
              result.totalRecomputed === 1 ? "" : "s"
            }${
              result.totalErrored > 0
                ? `, ${result.totalErrored} failed and were marked error`
                : ""
            }.`,
        variant: !dryRun && result.totalErrored > 0 ? "destructive" : undefined,
      });
    },
    onError: () => {
      toast({
        title: "Failed to run recompute",
        description: "Something went wrong while running the recompute.",
        variant: "destructive",
      });
    },
  });

  const anyRunPending =
    backfillMutation.isPending || recomputeMutation.isPending;

  usePageTitle(
    config ? `Denorm - ${config.name || config.pluginName}` : "Denorm",
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin" data-testid="loading-spinner" />
      </div>
    );
  }

  if (isError || !config) {
    return (
      <div className="space-y-6">
        <BackLink />
        <Card>
          <CardContent className="pt-6">
            <p
              className="text-center text-muted-foreground"
              data-testid="text-not-found"
            >
              This denorm plugin could not be found.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <BackLink />

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1
            className="text-xl md:text-2xl font-bold text-foreground"
            data-testid="text-page-title"
          >
            {config.name || config.pluginName}
          </h1>
          <p className="text-muted-foreground mt-1" data-testid="text-plugin-id">
            {config.pluginName}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant={config.enabled ? "default" : "secondary"}>
            {config.enabled ? "Enabled" : "Disabled"}
          </Badge>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setConfirmOpen(true)}
            disabled={clearMutation.isPending}
            data-testid="button-clear-records"
          >
            {clearMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4 mr-2" />
            )}
            Clear all records
          </Button>
        </div>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent data-testid="dialog-clear-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>Clear all denorm records?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes every precomputed record for{" "}
              <span className="font-medium">
                {config.name || config.pluginName}
              </span>
              {config.counts.total > 0 ? ` (${config.counts.total} total)` : ""}.
              The next backfill sweep will rebuild them as stale. This can't be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={clearMutation.isPending}
              data-testid="button-cancel-clear"
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                clearMutation.mutate();
              }}
              disabled={clearMutation.isPending}
              data-testid="button-confirm-clear"
            >
              {clearMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : null}
              Clear records
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {config.counts.total === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <p
              className="text-center text-muted-foreground"
              data-testid="text-empty-records"
            >
              No records are being tracked for this denorm plugin yet.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="OK" value={config.counts.ok} tone="ok" testId="ok" />
          <StatCard
            label="Stale"
            value={config.counts.stale}
            tone="stale"
            testId="stale"
          />
          <StatCard
            label="Error"
            value={config.counts.error}
            tone="error"
            testId="error"
          />
          <StatCard
            label="Total"
            value={config.counts.total}
            tone="total"
            testId="total"
          />
        </div>
      )}

      <Card data-testid="card-maintenance">
        <CardHeader>
          <CardTitle>How records stay up to date</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6 text-sm">
          <div className="space-y-1">
            <p className="font-medium text-foreground">Backfill job</p>
            <p className="text-muted-foreground">
              Runs every hour. It finds entities that are missing a precomputed
              record and queues them up as <span className="font-medium">stale</span>,
              and removes stray records whose entity no longer exists. This is
              what fills in the <span className="font-medium">Total</span> and
              creates work for the recompute job to pick up.
            </p>
          </div>
          <div className="space-y-1">
            <p className="font-medium text-foreground">Stale (recompute) job</p>
            <p className="text-muted-foreground">
              Also runs every hour. It takes the{" "}
              <span className="font-medium">stale</span> records, rebuilds their
              data, and marks them <span className="font-medium">OK</span>.
              Anything that fails to rebuild is marked{" "}
              <span className="font-medium">error</span> so it stays visible.
            </p>
          </div>

          <div className="flex flex-wrap gap-3 pt-1">
            <Link href="/cron-jobs/denorm_backfill/run">
              <Button
                variant="outline"
                size="sm"
                data-testid="link-cron-backfill"
              >
                <ExternalLink className="h-4 w-4 mr-2" />
                Backfill job (all plugins)
              </Button>
            </Link>
            <Link href="/cron-jobs/denorm_stale/run">
              <Button variant="outline" size="sm" data-testid="link-cron-stale">
                <ExternalLink className="h-4 w-4 mr-2" />
                Stale job (all plugins)
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>

      <Card data-testid="card-run-now">
        <CardHeader>
          <CardTitle>Run now for this plugin</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <p className="text-muted-foreground">
            Trigger the same jobs immediately, but scoped to{" "}
            <span className="font-medium">
              {config.name || config.pluginName}
            </span>{" "}
            only. Use <span className="font-medium">Preview</span> to see what a
            run would do without changing anything. These runs are not recorded
            in the cron job history.
          </p>

          <div className="space-y-3">
            <div className="space-y-2">
              <p className="font-medium text-foreground">Backfill</p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  onClick={() => backfillMutation.mutate("live")}
                  disabled={anyRunPending}
                  data-testid="button-run-backfill"
                >
                  {backfillMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <PlayCircle className="h-4 w-4 mr-2" />
                  )}
                  Run backfill now
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => backfillMutation.mutate("test")}
                  disabled={anyRunPending}
                  data-testid="button-preview-backfill"
                >
                  Preview
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <p className="font-medium text-foreground">Recompute stale</p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  onClick={() => recomputeMutation.mutate("live")}
                  disabled={anyRunPending}
                  data-testid="button-run-recompute"
                >
                  {recomputeMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4 mr-2" />
                  )}
                  Run recompute now
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => recomputeMutation.mutate("test")}
                  disabled={anyRunPending}
                  data-testid="button-preview-recompute"
                >
                  Preview
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/admin/denorm">
      <Button
        variant="ghost"
        size="sm"
        className="-ml-2"
        data-testid="button-back-to-denorm"
      >
        <ArrowLeft className="h-4 w-4 mr-2" />
        Back to Denorm
      </Button>
    </Link>
  );
}
