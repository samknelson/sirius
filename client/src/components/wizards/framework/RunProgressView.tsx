import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Play, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { WizardStepComponentProps } from "./types";

/**
 * Generic escape-hatch component for `run` steps. Kicks off the async
 * dispatcher run (POST .../dispatch/:stepId/run) and reflects progress
 * that the parent polls off the wizard load route — there is no bespoke
 * poll route. Any wizard with a `run` step can reuse this by re-exporting
 * it under `plugins/wizards/<type>/<Name>.tsx`.
 */
export function RunProgressView({ wizardId, wizardType, step, data }: WizardStepComponentProps) {
  const { toast } = useToast();
  const bao = wizardType === "bao_monthly_hours" && step.id === "process";
  const tracked = useQuery<any>({
    queryKey: [`/api/wizards/${wizardId}`],
    enabled: bao,
    refetchInterval: query => !query.state.data || query.state.data?.data?.progress?.process?.status === "in_progress" ? 2000 : false,
    refetchIntervalInBackground: true,
    retry: false,
  });
  const progress = bao ? tracked.data?.data?.progress?.process ?? step.progress : step.progress;
  const status = progress?.status;
  const pct = progress?.percentComplete ?? 0;
  const error = progress?.error;
  const running = status === "in_progress";
  const completed = bao ? status === "completed" : step.state === "completed";
  const failed = bao ? status === "failed" : step.state === "failed";
  const diagnostics = useQuery<{ persistenceProblem?: string | null }>({
    queryKey: [`/api/wizards/${wizardId}/dispatch/${step.id}/data`],
    enabled: bao,
    refetchInterval: query => running || !query.state.data ? 2000 : false,
    retry: false,
  });
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!bao || !running) return;
    const timer = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(timer);
  }, [bao, running]);
  const heartbeat = Date.parse(progress?.heartbeatAt ?? "");
  const stale = running && (!Number.isFinite(heartbeat) || now - heartbeat > 120_000);
  const persistenceProblem = diagnostics.data?.persistenceProblem;
  const attempted = bao && (!!status || !!(data as any)?.processResults);

  const runMutation = useMutation({
    mutationFn: async () =>
      apiRequest("POST", `/api/wizards/${wizardId}/dispatch/${step.id}/run`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/wizards/${wizardId}`] });
    },
    onError: (err: Error) => {
      toast({
        title: "Error",
        description: bao ? "Process admission is not confirmed. Refresh status before taking any action; do not automatically resubmit." : err.message || "Failed to start run",
        variant: "destructive",
      });
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {completed ? (
            <CheckCircle2 className="h-5 w-5 text-primary" />
          ) : failed ? (
            <AlertCircle className="h-5 w-5 text-destructive" />
          ) : running ? (
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          ) : (
            <Play className="h-5 w-5 text-muted-foreground" />
          )}
          {step.name}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {bao && (tracked.isError || diagnostics.isError) && (
          <Alert variant="destructive"><AlertDescription>
            Cannot read Process status. This is a browser polling problem, not proof that processing failed. Polling will continue; do not resubmit.
          </AlertDescription></Alert>
        )}
        {bao && progress?.runId && <p className="text-xs text-muted-foreground">
          Run {progress.runId} · {progress.protocol ?? "legacy process"}
        </p>}
        {persistenceProblem && <Alert variant="destructive"><AlertDescription>{persistenceProblem}</AlertDescription></Alert>}
        {bao && stale && !persistenceProblem && <Alert><AlertDescription>
          {Number.isFinite(heartbeat) ? "Process heartbeat is stale." : "Process heartbeat is missing."} Work may still be running or may have been interrupted. Refresh preserves tracking. Do not resubmit; ask an administrator to investigate possible partial posting.
        </AlertDescription></Alert>}
        {step.description && (
          <p className="text-sm text-muted-foreground">{step.description}</p>
        )}

        {running && (
          <div className="space-y-2" data-testid="run-progress">
            <Progress value={pct} />
            <p className="text-sm text-muted-foreground">
              Running… {pct}%
              {bao && progress?.phase && ` · ${progress.phase}`}
              {bao && progress?.total > 0 && ` · ${progress.processed ?? 0}/${progress.total} rows`}
            </p>
          </div>
        )}

        {bao && completed && progress?.partialPostingRisk && <Alert variant="destructive"><AlertDescription>
          Process finished with {progress.rowIssues ?? "some"} row issues. Review the saved results; some rows may not be fully posted. Do not resubmit without reconciliation.
        </AlertDescription></Alert>}
        {completed && (
          <Alert>
            <CheckCircle2 className="h-4 w-4" />
            <AlertDescription>
              Run complete. Continue to the results step to view and export.
            </AlertDescription>
          </Alert>
        )}

        {failed && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              {error || (bao ? "Process failed. Some records may already be posted. Do not resubmit; ask an administrator to reconcile this run." : "The run failed. Please try again.")}
            </AlertDescription>
          </Alert>
        )}

        <Button
          onClick={() => runMutation.mutate()}
          disabled={running || runMutation.isPending || (bao && (attempted || !tracked.data || tracked.isError))}
          data-testid="button-run-wizard"
        >
          {running ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Running…
            </>
          ) : completed ? (
            <>
              <Play className="h-4 w-4 mr-2" />
              Re-run
            </>
          ) : (
            <>
              <Play className="h-4 w-4 mr-2" />
              Run
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
