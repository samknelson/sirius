import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Play, CheckCircle2, AlertCircle, Loader2, RefreshCw } from "lucide-react";
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
    refetchInterval: query => {
      const current = query.state.data?.data?.progress?.[step.id]?.status;
      return !query.state.data || current === "in_progress" ? 2000 : false;
    },
    refetchIntervalInBackground: true,
    retry: false,
  });
  const progress = tracked.data?.data?.progress?.[step.id] ??
    (tracked.isError ? undefined : step.progress);
  const status = progress?.status;
  const pct = progress?.percentComplete ?? 0;
  const error = progress?.error;
  const running = status === "in_progress";
  const completed = status === "completed" || (!status && step.state === "completed");
  const failed = status === "failed";
  const diagnostics = useQuery<{ persistenceProblem?: string | null }>({
    queryKey: [`/api/wizards/${wizardId}/dispatch/${step.id}/data`],
    enabled: bao,
    refetchInterval: query => running || !query.state.data ? 2000 : false,
    retry: false,
  });
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(timer);
  }, [running]);
  const heartbeat = Date.parse(progress?.heartbeatAt ?? "");
  const stale = running && (!Number.isFinite(heartbeat) || now - heartbeat > 120_000);
  const persistenceProblem = diagnostics.data?.persistenceProblem;
  const attempted = bao && (!!status || !!(data as any)?.processResults);
  const safeTerminalRetry = step.retrySafe === true && (failed || completed);
  const canStart = !tracked.isError && !!tracked.data && !running &&
    (!status || safeTerminalRetry) && !attempted;

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
        {tracked.isError && (
          <Alert variant="destructive"><AlertDescription>
            Cannot read this run's current status. The work may still be running; refresh status before taking action. This is not proof that the run failed.
          </AlertDescription></Alert>
        )}
        {bao && diagnostics.isError && (
          <Alert variant="destructive"><AlertDescription>
            Cannot read Process status. This is a browser polling problem, not proof that processing failed. Polling will continue; do not resubmit.
          </AlertDescription></Alert>
        )}
        {progress?.runId && <p className="text-xs text-muted-foreground">
          Run {progress.runId} · {progress.protocol ?? "legacy process"}
        </p>}
        {progress?.attempts?.length ? (
          <p className="text-xs text-muted-foreground">
            Previous attempts: {progress.attempts.length}
          </p>
        ) : null}
        {persistenceProblem && <Alert variant="destructive"><AlertDescription>{persistenceProblem}</AlertDescription></Alert>}
        {stale && !persistenceProblem && <Alert><AlertDescription>
          {Number.isFinite(heartbeat) ? "The run heartbeat is stale." : "The run heartbeat is missing."} Work may still be running or may have been interrupted. A stale heartbeat is not a confirmed failure; refresh status and do not start another run.
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
              {error && <p>{error}</p>}
              {bao ? (
                <p>Some records may already be posted. Do not resubmit; ask an administrator to reconcile this run.</p>
              ) : step.retrySafe ? (
                <p>This step is marked safe to repeat. Review the saved failure details before choosing Retry run.</p>
              ) : (
                <p>This step is not marked safe to repeat. Preserve the failure details and ask an administrator to reconcile any partial effects.</p>
              )}
            </AlertDescription>
          </Alert>
        )}

        <Button
          onClick={() => runMutation.mutate()}
          disabled={!canStart || runMutation.isPending}
          data-testid="button-run-wizard"
        >
          {running ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Running…
            </>
          ) : failed && step.retrySafe ? (
            <>
              <RefreshCw className="h-4 w-4 mr-2" />
              Retry run
            </>
          ) : completed && step.retrySafe ? (
            <>
              <RefreshCw className="h-4 w-4 mr-2" />
              Run again
            </>
          ) : failed ? (
            <>
              <AlertCircle className="h-4 w-4 mr-2" />
              Manual recovery required
            </>
          ) : completed ? (
            <>
              <CheckCircle2 className="h-4 w-4 mr-2" />
              Completed
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
