/**
 * Restart & Reload (Task #1258).
 *
 * Two deliberately unequal actions:
 *
 *   - Reload configuration — an in-process re-read of the subsystems that can
 *     honestly be reloaded. No downtime, one click.
 *   - Restart application — a graceful shutdown followed by a process exit,
 *     relying on whatever supervises the container to start a fresh process.
 *
 * The page opens with the Container Information status plugin's own summary
 * and details, rendered through the shared status components — there is no
 * second copy of the detection logic here. The restart PREDICTION and the
 * confirmation strength come from the server's structured container facts,
 * never from parsing those rendered strings.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { apiRequest, queryClient, getApiErrorMessage } from "@/lib/queryClient";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
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
import { useToast } from "@/hooks/use-toast";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Power,
  RefreshCw,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import {
  CARD_PRIORITY_CLASSES,
  PriorityIcon,
  StatusDetailsView,
  StatusMessageList,
  type StatusDetails,
  type SystemStatusEntry,
} from "@/components/system-status/status-render";

const CONTAINER_PLUGIN_ID = "container";

/** How long to keep polling /health for a new process before giving up. */
const POLL_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 2_000;

interface RestartPrediction {
  willComeBack: boolean | null;
  headline: string;
  paragraphs: string[];
  requiresTypedConfirmation: boolean;
  exitCode: number;
}

interface ReloadableEntry {
  id: string;
  label: string;
  reReads: string;
  makesLive: string[];
}

interface RestartOnlyEntry {
  id: string;
  label: string;
  reReads: string;
  reason: string;
}

interface PendingRestartVariable {
  name: string;
  description: string;
  category: string;
  secret: boolean;
  change: "added" | "changed" | "removed";
}

interface RestartInfo {
  boot: { bootId: string; startedAt: string };
  container: {
    platform: string;
    platformLabel: string;
    supervised: boolean | null;
    isPid1: boolean;
    siblingInstancesPossible: boolean | null;
  };
  prediction: RestartPrediction;
  confirmPhrase: string;
  reloadable: ReloadableEntry[];
  restartOnly: RestartOnlyEntry[];
  pendingRestartVariables: PendingRestartVariable[];
  pendingRestartKnown: boolean;
}

interface ReloadResult {
  id: string;
  label: string;
  ok: boolean;
  message: string;
  durationMs: number;
}

type RestartPhase = "idle" | "waiting" | "back" | "timeout";

export default function RestartPage() {
  usePageTitle("Restart & Reload");
  const { toast } = useToast();

  const [reloadResults, setReloadResults] = useState<ReloadResult[] | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [phase, setPhase] = useState<RestartPhase>("idle");
  const [pollElapsed, setPollElapsed] = useState(0);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const { data: info, isLoading: infoLoading, error: infoError } = useQuery<RestartInfo>({
    queryKey: ["/api/admin/restart/info"],
    staleTime: 0,
  });

  const {
    data: statusEntry,
    isLoading: statusLoading,
    error: statusError,
  } = useQuery<SystemStatusEntry>({
    queryKey: [`/api/system-status/${CONTAINER_PLUGIN_ID}`],
  });

  const {
    data: statusDetails,
    isLoading: detailsLoading,
    error: detailsError,
  } = useQuery<StatusDetails>({
    queryKey: [`/api/system-status/${CONTAINER_PLUGIN_ID}/details`],
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
  });

  useEffect(
    () => () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
    },
    [],
  );

  /**
   * Poll /health until a process answers with a bootId other than the one we
   * captured before firing. A same-bootId answer means the old process is
   * still up (the exit has not happened yet, or never will).
   */
  const startPolling = useCallback((previousBootId: string) => {
    setPhase("waiting");
    setPollElapsed(0);
    const startedAt = Date.now();
    if (pollTimer.current) clearInterval(pollTimer.current);
    pollTimer.current = setInterval(async () => {
      const elapsed = Date.now() - startedAt;
      setPollElapsed(elapsed);
      if (elapsed > POLL_TIMEOUT_MS) {
        if (pollTimer.current) clearInterval(pollTimer.current);
        pollTimer.current = null;
        setPhase("timeout");
        return;
      }
      try {
        const response = await fetch("/health", { cache: "no-store" });
        if (!response.ok) return;
        const body = (await response.json()) as { bootId?: string; status?: string };
        if (body.bootId && body.bootId !== previousBootId && body.status === "ready") {
          if (pollTimer.current) clearInterval(pollTimer.current);
          pollTimer.current = null;
          setPhase("back");
          queryClient.clear();
        }
      } catch {
        // Connection refused while the process is down is the expected case.
      }
    }, POLL_INTERVAL_MS);
  }, []);

  const reloadMutation = useMutation({
    mutationFn: async (ids?: string[]) =>
      (await apiRequest("POST", "/api/admin/restart/reload", ids ? { ids } : {})) as {
        results: ReloadResult[];
        pendingRestartVariables: PendingRestartVariable[];
      },
    onSuccess: (data) => {
      setReloadResults(data.results);
      queryClient.setQueryData<RestartInfo>(["/api/admin/restart/info"], (old) =>
        old ? { ...old, pendingRestartVariables: data.pendingRestartVariables } : old,
      );
      const failed = data.results.filter((r) => !r.ok);
      toast({
        title: failed.length === 0 ? "Configuration reloaded" : "Reload finished with errors",
        description:
          failed.length === 0
            ? `${data.results.length} subsystem${data.results.length === 1 ? "" : "s"} re-read.`
            : `${failed.length} of ${data.results.length} failed.`,
        variant: failed.length === 0 ? undefined : "destructive",
      });
    },
    onError: (error) =>
      toast({
        title: "Reload failed",
        description: getApiErrorMessage(error, "Failed to reload configuration"),
        variant: "destructive",
      }),
  });

  const restartMutation = useMutation({
    // The confirmation phrase is sent for the server to check — the input box
    // below is only how a browser satisfies a gate the server enforces.
    mutationFn: async (confirm: string) =>
      (await apiRequest("POST", "/api/admin/restart", { confirm })) as {
        ok: boolean;
        bootId: string;
      },
    onSuccess: (data) => {
      setConfirmOpen(false);
      setConfirmText("");
      startPolling(data.bootId);
    },
    onError: (error) =>
      toast({
        title: "Restart failed",
        description: getApiErrorMessage(error, "Failed to restart the application"),
        variant: "destructive",
      }),
  });

  if (infoLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (infoError || !info) {
    return (
      <Alert variant="destructive">
        <XCircle className="h-4 w-4" />
        <AlertTitle>Could not load restart information</AlertTitle>
        <AlertDescription>
          {getApiErrorMessage(infoError, "The server did not answer.")}
        </AlertDescription>
      </Alert>
    );
  }

  const prediction = info.prediction;
  const typedConfirmOk =
    !prediction.requiresTypedConfirmation || confirmText.trim() === info.confirmPhrase;

  // --- restarting state ----------------------------------------------------
  if (phase !== "idle") {
    return (
      <div className="space-y-6 max-w-3xl">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Power className="h-6 w-6" />
          Restart &amp; Reload
        </h1>
        {phase === "waiting" && (
          <Card data-testid="card-restart-waiting">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Loader2 className="h-4 w-4 animate-spin" />
                Restarting…
              </CardTitle>
              <CardDescription>
                Waiting for a new process to answer. The page checks every{" "}
                {POLL_INTERVAL_MS / 1000} seconds and will keep trying for{" "}
                {POLL_TIMEOUT_MS / 1000} seconds.
              </CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              <p>
                Elapsed: {Math.round(pollElapsed / 1000)}s. Success is only reported when a
                process with a different boot identifier answers — so this cannot be fooled by
                the old process still being up.
              </p>
            </CardContent>
          </Card>
        )}
        {phase === "back" && (
          <Card
            className={CARD_PRIORITY_CLASSES.info}
            data-testid="card-restart-succeeded"
          >
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
                A new process is serving
              </CardTitle>
              <CardDescription>
                The application restarted and reports itself ready.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                onClick={() => window.location.reload()}
                data-testid="button-reload-page"
              >
                Reload this page
              </Button>
            </CardContent>
          </Card>
        )}
        {phase === "timeout" && (
          <Card
            className={CARD_PRIORITY_CLASSES.warning}
            data-testid="card-restart-timeout"
          >
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
                No new process answered
              </CardTitle>
              <CardDescription>
                Nothing answered with a new boot identifier within{" "}
                {POLL_TIMEOUT_MS / 1000} seconds.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>What to try next:</p>
              <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
                <li>
                  Reload this page — a slow boot (migrations, schema drift check) can take
                  longer than the wait above.
                </li>
                <li>
                  Check the container logs on your platform. A process that exited and failed
                  to boot again will have written the reason there.
                </li>
                <li>
                  If nothing is supervising this container, start it again from your platform
                  or redeploy.
                </li>
              </ul>
              <Button
                variant="outline"
                onClick={() => window.location.reload()}
                data-testid="button-reload-page"
              >
                Reload this page
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  // --- normal state --------------------------------------------------------
  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Power className="h-6 w-6" />
          Restart &amp; Reload
        </h1>
        <p className="text-muted-foreground mt-1">
          Re-read configuration in place, or end this process and let the platform start a
          fresh one.
        </p>
      </div>

      {/* Container Information — the status plugin's own output, rendered
          through the same components the System Status page uses. */}
      <Card data-testid="card-container-information">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            {statusEntry && <PriorityIcon priority={statusEntry.worstPriority} />}
            {statusEntry?.name ?? "Container Information"}
          </CardTitle>
          <CardDescription>
            {statusEntry?.description ??
              "What this process can determine about where it is running."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {statusLoading && <Skeleton className="h-20 w-full" />}
          {statusError != null && (
            <p className="text-sm text-destructive">
              {getApiErrorMessage(statusError, "Failed to load container information")}
            </p>
          )}
          {statusEntry && (
            <StatusMessageList
              messages={statusEntry.result.messages}
              testIdPrefix="row-status-message-container"
            />
          )}
          <Separator />
          {detailsLoading && <Skeleton className="h-32 w-full" />}
          {detailsError != null && (
            <p className="text-sm text-destructive">
              {getApiErrorMessage(detailsError, "Failed to load details")}
            </p>
          )}
          {statusDetails && (
            <div className="space-y-4">
              <StatusDetailsView details={statusDetails} />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Prediction — computed server-side from the structured facts. */}
      <Alert
        variant={prediction.willComeBack === true ? "default" : "destructive"}
        data-testid="alert-restart-prediction"
      >
        {prediction.willComeBack === true ? (
          <CheckCircle2 className="h-4 w-4" />
        ) : (
          <ShieldAlert className="h-4 w-4" />
        )}
        <AlertTitle>{prediction.headline}</AlertTitle>
        <AlertDescription>
          <div className="space-y-2 mt-1">
            {prediction.paragraphs.map((paragraph, i) => (
              <p key={i} data-testid={`text-prediction-${i}`}>
                {paragraph}
              </p>
            ))}
          </div>
        </AlertDescription>
      </Alert>

      {/* ---------------------------------------------------------------- */}
      {/* Reload configuration                                             */}
      {/* ---------------------------------------------------------------- */}
      <Card data-testid="card-reload">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <RefreshCw className="h-4 w-4" />
            Reload configuration
          </CardTitle>
          <CardDescription>
            Re-reads the subsystems below in place. No downtime, nobody is signed out, and
            nothing is interrupted.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="divide-y rounded-md border">
            {info.reloadable.map((entry) => {
              const result = reloadResults?.find((r) => r.id === entry.id);
              return (
                <div key={entry.id} className="p-3" data-testid={`row-reloadable-${entry.id}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{entry.label}</div>
                      <div className="text-sm text-muted-foreground">{entry.reReads}</div>
                      {entry.makesLive.length > 0 && (
                        <div className="mt-1 flex flex-wrap items-center gap-1">
                          <span className="text-xs text-muted-foreground">Makes live:</span>
                          {entry.makesLive.map((name) => (
                            <Badge key={name} variant="outline" className="text-xs font-mono">
                              {name}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => reloadMutation.mutate([entry.id])}
                      disabled={reloadMutation.isPending}
                      data-testid={`button-reload-${entry.id}`}
                    >
                      Reload
                    </Button>
                  </div>
                  {result && (
                    <div
                      className="mt-2 flex items-start gap-2 text-sm"
                      data-testid={`text-reload-result-${entry.id}`}
                    >
                      {result.ok ? (
                        <CheckCircle2 className="h-4 w-4 mt-0.5 text-green-600 dark:text-green-400 shrink-0" />
                      ) : (
                        <XCircle className="h-4 w-4 mt-0.5 text-destructive shrink-0" />
                      )}
                      <span className={result.ok ? "text-muted-foreground" : "text-destructive"}>
                        {result.message} ({result.durationMs}ms)
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <Button
            onClick={() => reloadMutation.mutate(undefined)}
            disabled={reloadMutation.isPending}
            data-testid="button-reload-all"
          >
            {reloadMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            Reload all
          </Button>

          <div>
            <h3 className="text-sm font-semibold mb-2">Restart only</h3>
            <p className="text-sm text-muted-foreground mb-2">
              These cannot be re-read in place. Reloading would change nothing, so the page
              does not offer it.
            </p>
            <div className="divide-y rounded-md border">
              {info.restartOnly.map((entry) => (
                <div
                  key={entry.id}
                  className="p-3 text-sm"
                  data-testid={`row-restart-only-${entry.id}`}
                >
                  <div className="font-medium">{entry.label}</div>
                  <div className="text-muted-foreground">{entry.reReads}</div>
                  <div className="text-muted-foreground mt-1">{entry.reason}</div>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ---------------------------------------------------------------- */}
      {/* Waiting on a restart                                             */}
      {/* ---------------------------------------------------------------- */}
      <Card data-testid="card-pending-variables">
        <CardHeader>
          <CardTitle className="text-base">Waiting on a restart</CardTitle>
          <CardDescription>
            Environment variables classified as taking effect only at startup whose value has
            changed since this process started.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!info.pendingRestartKnown ? (
            <p className="text-sm text-muted-foreground">
              This process did not reach the point where it records a baseline, so which
              variables are waiting cannot be determined.
            </p>
          ) : info.pendingRestartVariables.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="text-no-pending">
              Nothing is waiting on a restart.
            </p>
          ) : (
            <div className="divide-y rounded-md border">
              {info.pendingRestartVariables.map((variable) => (
                <div
                  key={variable.name}
                  className="p-3 text-sm"
                  data-testid={`row-pending-${variable.name}`}
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono font-medium">{variable.name}</span>
                    <Badge variant="secondary" className="text-xs">
                      {variable.change}
                    </Badge>
                    {variable.secret && (
                      <Badge variant="outline" className="text-xs">
                        secret
                      </Badge>
                    )}
                  </div>
                  {variable.description && (
                    <div className="text-muted-foreground">{variable.description}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ---------------------------------------------------------------- */}
      {/* Restart application                                              */}
      {/* ---------------------------------------------------------------- */}
      <Card
        className={
          prediction.willComeBack === true
            ? CARD_PRIORITY_CLASSES.notice
            : CARD_PRIORITY_CLASSES.error
        }
        data-testid="card-restart"
      >
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Power className="h-4 w-4" />
            Restart application
          </CardTitle>
          <CardDescription>
            Ends this process with exit code {prediction.exitCode}. The site is unreachable
            until a replacement process is serving. Background work running at that moment is
            interrupted.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {prediction.requiresTypedConfirmation && (
            <div className="space-y-2">
              <p className="text-sm font-medium">
                Type {info.confirmPhrase} to confirm you accept that the app may not come back
                on its own.
              </p>
              <Input
                value={confirmText}
                onChange={(event) => setConfirmText(event.target.value)}
                placeholder={info.confirmPhrase}
                className="max-w-xs font-mono"
                data-testid="input-restart-confirm"
              />
            </div>
          )}
          <Button
            variant="destructive"
            onClick={() => setConfirmOpen(true)}
            disabled={!typedConfirmOk || restartMutation.isPending}
            data-testid="button-restart"
          >
            {restartMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Power className="h-4 w-4 mr-2" />
            )}
            Restart application
          </Button>
        </CardContent>
      </Card>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restart the application?</AlertDialogTitle>
            <AlertDialogDescription>
              {prediction.headline} This process will exit with code {prediction.exitCode} and
              cannot start itself again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-restart-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                restartMutation.mutate(confirmText.trim());
              }}
              data-testid="button-restart-confirm"
            >
              Restart now
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
