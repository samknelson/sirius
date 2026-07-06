import { useMutation } from "@tanstack/react-query";
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
export function RunProgressView({ wizardId, step }: WizardStepComponentProps) {
  const { toast } = useToast();
  const status = step.progress?.status;
  const pct = step.progress?.percentComplete ?? 0;
  const error = step.progress?.error;
  const running = status === "in_progress";
  const completed = step.state === "completed";
  const failed = step.state === "failed";

  const runMutation = useMutation({
    mutationFn: async () =>
      apiRequest("POST", `/api/wizards/${wizardId}/dispatch/${step.id}/run`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/wizards/${wizardId}`] });
    },
    onError: (err: Error) => {
      toast({
        title: "Error",
        description: err.message || "Failed to start run",
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
        {step.description && (
          <p className="text-sm text-muted-foreground">{step.description}</p>
        )}

        {running && (
          <div className="space-y-2" data-testid="run-progress">
            <Progress value={pct} />
            <p className="text-sm text-muted-foreground">
              Running… {pct}%
            </p>
          </div>
        )}

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
              {error || "The run failed. Please try again."}
            </AlertDescription>
          </Alert>
        )}

        <Button
          onClick={() => runMutation.mutate()}
          disabled={running || runMutation.isPending}
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
