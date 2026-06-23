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
import { Loader2, ArrowLeft, Trash2 } from "lucide-react";
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

  const clearMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", `/api/denorm/configs/${configId}/clear`);
    },
    onSuccess: (result: { deleted: number }) => {
      setConfirmOpen(false);
      queryClient.invalidateQueries({
        queryKey: ["/api/denorm/configs", configId],
      });
      queryClient.invalidateQueries({ queryKey: ["/api/denorm/configs"] });
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
