import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Database,
  Loader2,
  Play,
  RotateCcw,
  ShieldAlert,
  XCircle,
  Square,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getApiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type StatusName = "draft" | "request" | "lock" | "trash" | "reserved";
type Cursor = { startDate?: string; page?: number; sweepStartedAt?: string };
type StatusResponse = {
  variableName: string;
  statuses: Record<StatusName, Cursor>;
  warning?: string;
  run: {
    lifecycle: "idle" | "starting" | "running" | "stopping" | "stopped" | "completed" | "failed";
    limit: number | null;
    startedAt: string | null;
    finishedAt: string | null;
    heartbeatAt: string | null;
    batchCount: number;
    totals: {
      fetched: number; valid: number; created: number; updated: number; failed: number;
      records: RunRecordCounts;
    };
    latestBatch: RunResponse | null;
    error: string | null;
  };
};
type RunStage = "fetch" | "response" | "source" | "relation_resolution" | "validation" | "canonical_save" | "processing";
type SheetOutcome = "would_create" | "would_update" | "created" | "updated" | "failed";
type RunError = {
  stage: RunStage;
  code: string;
  message: string;
  details?: string;
};
type RunSheet = {
  nid?: string;
  sheetId?: string;
  title: string;
  sourceStatus: StatusName;
  outcome: SheetOutcome;
  records?: RunRecordCounts;
  stage?: RunStage;
  message?: string;
  details?: string;
};
type RunRecordCounts = {
  crews: { created: number; updated: number };
  assignments: { created: number; updated: number };
  workers: { created: number; updated: number };
};
type RunStatus = {
  status: StatusName;
  label: string;
  fetched: number;
  valid: number;
  created: number;
  updated: number;
  failed: number;
  records: RunRecordCounts;
  page: number;
  nextPage: number;
  complete: boolean;
  request: {
    status: StatusName;
    page: number;
    limit: number;
    startDate: string;
    sweepStartedAt: string | null;
  };
  fetch: {
    outcome: "success" | "failed";
    source?: "cache" | "network" | "none";
    responseShape?: "success.data.success.data.sheets";
  };
  error?: RunError;
  sheets: RunSheet[];
};
type RunResponse = {
  mode: "test" | "live";
  limit: number;
  stoppedEarly?: boolean;
  statuses: RunStatus[];
  startedAt: string;
  durationMs: number;
};

const STATUS_ORDER: StatusName[] = ["draft", "request", "lock", "trash", "reserved"];
const STATUS_LABELS: Record<StatusName, string> = {
  draft: "Draft",
  request: "Requested",
  lock: "Scheduled",
  trash: "Discarded",
  reserved: "Reserved",
};
const STATUS_KEY = "/api/sitespecific/freeman/edls-migrate/import/status";
const RUN_KEY = "/api/sitespecific/freeman/edls-migrate/import/run";
const RESET_KEY = "/api/sitespecific/freeman/edls-migrate/import/reset";
const START_KEY = "/api/sitespecific/freeman/edls-migrate/import/start";
const STOP_KEY = "/api/sitespecific/freeman/edls-migrate/import/stop";

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, credentials: "include" });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ message: "Request failed" }));
    throw new Error(body.message || `HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

function formatDate(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function humanize(value: string) {
  return value.replace(/_/g, " ");
}

function SheetOutcomeBadge({ outcome }: { outcome: SheetOutcome }) {
  if (outcome === "failed") return <Badge variant="destructive">Failed</Badge>;
  if (outcome === "created") return <Badge>Created</Badge>;
  if (outcome === "updated") return <Badge>Updated</Badge>;
  return <Badge variant="secondary">{outcome === "would_create" ? "Would create" : "Would update"}</Badge>;
}

function RecordCountSummary({
  records,
  mode,
}: {
  records: RunRecordCounts;
  mode?: "test" | "live";
}) {
  const createLabel = mode === "test" ? "would create" : "created";
  const updateLabel = mode === "test" ? "would update" : "updated";
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
      {(["crews", "assignments", "workers"] as const).map((kind) => (
        <span key={kind}>
          {kind}: {records[kind].created} {createLabel}, {records[kind].updated} {updateLabel}
        </span>
      ))}
    </div>
  );
}

function StatusRow({ name, cursor, outcome, mode }: {
  name: StatusName;
  cursor?: Cursor;
  outcome?: RunStatus;
  mode?: "test" | "live";
}) {
  return (
    <div className="grid gap-2 border-b px-3 py-3 last:border-0 sm:grid-cols-[1fr_1.4fr_1.5fr] sm:items-center">
      <div className="flex items-center gap-2">
        {outcome ? (
          outcome.complete && outcome.failed === 0 ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          ) : (
            <XCircle className="h-4 w-4 text-destructive" />
          )
        ) : (
          <Clock3 className="h-4 w-4 text-muted-foreground" />
        )}
        <span className="font-medium">{outcome?.label || STATUS_LABELS[name]}</span>
      </div>
      <div className="text-xs text-muted-foreground">
        <span className="font-mono">page {cursor?.page ?? 0}</span>
        <span className="mx-2">·</span>
        <span>start {formatDate(cursor?.startDate)}</span>
        <span className="mx-2">·</span>
        sweep {formatDate(cursor?.sweepStartedAt)}
      </div>
      {outcome ? (
        <div className="space-y-1">
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>{outcome.fetched} fetched</span>
            <span>{outcome.valid} valid</span>
            <span>{outcome.created} {mode === "test" ? "would create" : "created"}</span>
            <span>{outcome.updated} {mode === "test" ? "would update" : "updated"}</span>
            {outcome.failed > 0 && <span className="font-medium text-destructive">{outcome.failed} failed</span>}
          </div>
          <RecordCountSummary records={outcome.records} mode={mode} />
        </div>
      ) : (
        <div className="text-xs text-muted-foreground">No outcome in this session</div>
      )}
    </div>
  );
}

export default function MigrateSheets() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [limit, setLimit] = useState("100");
  const [latestRun, setLatestRun] = useState<RunResponse | null>(null);
  const statusQuery = useQuery<StatusResponse>({
    queryKey: [STATUS_KEY],
    refetchInterval: (query) => {
      const lifecycle = query.state.data?.run.lifecycle;
      return lifecycle === "starting" || lifecycle === "running" || lifecycle === "stopping" ? 3000 : false;
    },
  });
  const validLimit = Math.min(100, Math.max(1, Number(limit) || 1));

  const runMutation = useMutation({
    mutationFn: ({ mode }: { mode: "test" | "live" }) =>
      requestJson<RunResponse>(RUN_KEY, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, limit: validLimit }),
      }),
    onSuccess: (run) => {
      setLatestRun(run);
      queryClient.invalidateQueries({ queryKey: [STATUS_KEY] });
      toast({ title: `${run.mode === "live" ? "Live" : "Test"} import finished`, description: `${run.statuses.length} status groups processed in ${Math.round(run.durationMs / 100) / 10}s.` });
    },
    onError: (error: Error) => toast({ title: "Import could not run", description: getApiErrorMessage(error, "The migration request failed."), variant: "destructive" }),
  });
  const resetMutation = useMutation({
    mutationFn: () => requestJson<StatusResponse>(RESET_KEY, { method: "POST" }),
    onSuccess: (status) => {
      setLatestRun(null);
      queryClient.setQueryData([STATUS_KEY], status);
      toast({ title: "Import cursor reset", description: "Nid mappings were preserved." });
    },
    onError: (error: Error) => toast({ title: "Start Over failed", description: getApiErrorMessage(error, "The import cursor could not be reset."), variant: "destructive" }),
  });
  const startMutation = useMutation({
    mutationFn: () => requestJson<StatusResponse>(START_KEY, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ limit: validLimit }),
    }),
    onSuccess: (status) => {
      setLatestRun(null);
      queryClient.setQueryData([STATUS_KEY], status);
      toast({ title: "Background import started", description: "It will continue in the background if you leave this page." });
    },
    onError: (error: Error) => toast({ title: "Migration could not start", description: getApiErrorMessage(error, "A live run may already be active."), variant: "destructive" }),
  });
  const stopMutation = useMutation({
    mutationFn: () => requestJson<StatusResponse>(STOP_KEY, { method: "POST" }),
    onSuccess: (status) => {
      queryClient.setQueryData([STATUS_KEY], status);
      toast({ title: "Safe stop requested", description: "The active sheet or page request will finish; no new sheet will start." });
    },
    onError: (error: Error) => toast({ title: "Stop could not be requested", description: getApiErrorMessage(error, "Try again."), variant: "destructive" }),
  });

  const lifecycle = statusQuery.data?.run.lifecycle ?? "idle";
  const liveActive = lifecycle === "starting" || lifecycle === "running" || lifecycle === "stopping";
  const displayedRun = latestRun ?? statusQuery.data?.run.latestBatch ?? null;
  const busy = runMutation.isPending || resetMutation.isPending || startMutation.isPending || stopMutation.isPending;
  const outcomes = useMemo(() => new Map(displayedRun?.statuses.map((item) => [item.status, item]) ?? []), [displayedRun]);
  const statuses = statusQuery.data?.statuses;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Database className="h-5 w-5" />
          Migrate sheets
        </CardTitle>
        <CardDescription>
          Import Freeman EDLS sheets by legacy status. Test mode reports what would change; Live mode writes records and advances the cursors.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {statusQuery.isLoading && <div className="h-20 animate-pulse rounded-md bg-muted" data-testid="status-loading" />}
        {statusQuery.isError && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{getApiErrorMessage(statusQuery.error, "Could not load import status.")}</AlertDescription>
          </Alert>
        )}
        {statusQuery.data?.warning && (
          <Alert variant="destructive" data-testid="alert-import-warning">
            <ShieldAlert className="h-4 w-4" />
            <AlertTitle>Paging safety warning</AlertTitle>
            <AlertDescription>{statusQuery.data.warning}</AlertDescription>
          </Alert>
        )}
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            Legacy paging uses mutable offsets. Records can move while a sweep is running, so review every outcome before proceeding. <strong>Start Over resets cursors but preserves nid mappings.</strong>
          </AlertDescription>
        </Alert>
        {statusQuery.data?.run && (
          <div className="rounded-md border p-3" data-testid="card-import-run-status">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={lifecycle === "failed" ? "destructive" : "secondary"}>{lifecycle.toUpperCase()}</Badge>
              <span className="text-sm font-medium">{statusQuery.data.run.batchCount} completed batch(es)</span>
              <span className="text-xs text-muted-foreground">
                started {formatDate(statusQuery.data.run.startedAt ?? undefined)} · finished {formatDate(statusQuery.data.run.finishedAt ?? undefined)}
              </span>
              {liveActive && (
                <span className="text-xs text-muted-foreground">
                  heartbeat {formatDate(statusQuery.data.run.heartbeatAt ?? undefined)}
                </span>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
              <span>{statusQuery.data.run.totals.fetched} sheets fetched</span>
              <span>{statusQuery.data.run.totals.created} created</span>
              <span>{statusQuery.data.run.totals.updated} updated</span>
              <span>{statusQuery.data.run.totals.failed} failed</span>
            </div>
            <RecordCountSummary records={statusQuery.data.run.totals.records} mode="live" />
            {lifecycle === "stopping" && (
              <p className="mt-2 text-sm text-muted-foreground" data-testid="text-import-stopping">
                Finishing the active sheet transaction or page request. No new sheet will start.
              </p>
            )}
            {statusQuery.data.run.error && <p className="mt-2 text-sm text-destructive">{statusQuery.data.run.error}</p>}
          </div>
        )}

        <div className="flex flex-col gap-3 rounded-md border bg-muted/30 p-3 sm:flex-row sm:items-end">
          <div className="w-full space-y-1 sm:max-w-[180px]">
            <Label htmlFor="import-limit">Batch limit</Label>
            <Input
              id="import-limit"
              type="number"
              min={1}
              max={100}
              value={limit}
              onChange={(event) => setLimit(event.target.value)}
              disabled={busy || liveActive}
              data-testid="input-import-limit"
            />
            <p className="text-xs text-muted-foreground">1–100 records per status; default 100.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => runMutation.mutate({ mode: "test" })} disabled={busy || liveActive || statusQuery.isLoading} data-testid="button-import-test">
              {runMutation.isPending && runMutation.variables?.mode === "test" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
              Run test
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" disabled={busy || liveActive || statusQuery.isLoading} data-testid="button-import-live-batch">
                  <ShieldAlert className="mr-2 h-4 w-4" /> Run one live batch
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Run one live Freeman batch?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This writes EDLS records, may update existing records, and advances the cursors once. It will process up to {validLimit} records for each legacy status, then return this batch&apos;s report.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => runMutation.mutate({ mode: "live" })}>Run one live batch</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" disabled={busy || liveActive || statusQuery.isLoading} data-testid="button-import-background">
                  <Play className="mr-2 h-4 w-4" /> Start background import
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Start the background Freeman import?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This writes EDLS records and continues running batches in the background until the migration completes, fails, or is safely stopped. Each batch processes up to {validLimit} records for each legacy status.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => startMutation.mutate()}>Start background import</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <Button variant="destructive" onClick={() => stopMutation.mutate()} disabled={busy || !liveActive || lifecycle === "stopping"} data-testid="button-import-stop">
              {stopMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Square className="mr-2 h-4 w-4" />}
              {lifecycle === "stopping" ? "Stopping…" : "Stop safely"}
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" disabled={busy || liveActive} data-testid="button-import-reset">
                  {resetMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />}
                  Start Over
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Reset import cursors?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This starts paging again from the beginning. Existing nid mappings are preserved, but a later live run may revisit records and update them.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => resetMutation.mutate()}>Reset and start over</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>

        <div className="rounded-md border" data-testid="import-status-list">
          <div className="border-b bg-muted/40 px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Cursor and latest outcome {statusQuery.data?.variableName && <span className="ml-2 font-mono normal-case">{statusQuery.data.variableName}</span>}
          </div>
          {STATUS_ORDER.map((name) => (
            <StatusRow
              key={name}
              name={name}
              cursor={statuses?.[name]}
              outcome={outcomes.get(name)}
                mode={displayedRun?.mode}
            />
          ))}
        </div>

        {displayedRun && (
          <div className="space-y-4 rounded-md border p-3" data-testid="card-import-outcome">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant={displayedRun.mode === "live" ? "destructive" : "secondary"}>{displayedRun.mode === "live" ? "LIVE" : "TEST"}</Badge>
              <span className="font-medium">Latest outcome</span>
              <span className="text-xs text-muted-foreground">started {formatDate(displayedRun.startedAt)} · limit {displayedRun.limit} · {Math.round(displayedRun.durationMs / 100) / 10}s</span>
            </div>
            <div className="space-y-3">
              {displayedRun.statuses.map((item) => (
                <section key={item.status} className="overflow-hidden rounded-md border" data-testid={`import-result-${item.status}`}>
                  <div className="flex flex-col gap-2 border-b bg-muted/30 px-3 py-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{item.label}</span>
                        <Badge variant={item.fetch.outcome === "success" ? "outline" : "destructive"}>
                          {item.fetch.outcome === "success" ? "Fetched" : "Fetch failed"}
                        </Badge>
                        {item.complete && <Badge variant="secondary">Sweep complete</Badge>}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Requested status <span className="font-mono">{item.request.status}</span>
                        {" · "}page {item.request.page}
                        {" · "}limit {item.request.limit}
                        {" · "}start {formatDate(item.request.startDate)}
                        {" · "}next page {item.nextPage}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Fetch source {item.fetch.source ?? "none"}
                        {item.fetch.responseShape ? ` · response ${item.fetch.responseShape}` : ""}
                      </p>
                    </div>
                    <div className="space-y-1">
                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span>{item.fetched} fetched</span>
                        <span>{item.valid} succeeded</span>
                        <span>{item.created} {displayedRun.mode === "test" ? "would create" : "created"}</span>
                        <span>{item.updated} {displayedRun.mode === "test" ? "would update" : "updated"}</span>
                        <span className={item.failed ? "font-medium text-destructive" : ""}>{item.failed} failed</span>
                      </div>
                      <RecordCountSummary records={item.records} mode={displayedRun.mode} />
                    </div>
                  </div>

                  {item.error && (
                    <div className="p-3">
                      <Alert variant="destructive">
                        <XCircle className="h-4 w-4" />
                        <AlertTitle>{humanize(item.error.stage)} failed</AlertTitle>
                        <AlertDescription className="space-y-1">
                          <p>{item.error.message}</p>
                          {item.error.details && <p className="font-mono text-xs">{item.error.details}</p>}
                          <p className="text-xs">Code: {item.error.code}</p>
                        </AlertDescription>
                      </Alert>
                    </div>
                  )}

                  {!item.error && item.sheets.length === 0 && (
                    <p className="px-3 py-4 text-sm text-muted-foreground">
                      Freeman returned no sheets for this status and page.
                    </p>
                  )}

                  {item.sheets.length > 0 && (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[720px] text-left text-sm">
                        <thead className="border-b bg-muted/20 text-xs text-muted-foreground">
                          <tr>
                            <th className="px-3 py-2 font-medium">Sheet</th>
                            <th className="px-3 py-2 font-medium">Source nid</th>
                            <th className="px-3 py-2 font-medium">Outcome</th>
                            <th className="px-3 py-2 font-medium">Details</th>
                          </tr>
                        </thead>
                        <tbody>
                          {item.sheets.map((sheet, index) => (
                            <tr key={`${sheet.nid ?? "unknown"}-${index}`} className="border-b last:border-0">
                              <td className="max-w-[260px] px-3 py-3 font-medium">
                                {sheet.sheetId ? (
                                  <Link
                                    href={`/edls/sheet/${sheet.sheetId}`}
                                    className="text-primary underline-offset-4 hover:underline"
                                    data-testid={`link-migrated-sheet-${sheet.sheetId}`}
                                  >
                                    {sheet.title}
                                  </Link>
                                ) : (
                                  sheet.title
                                )}
                              </td>
                              <td className="px-3 py-3 font-mono text-xs">{sheet.nid ?? "Missing"}</td>
                              <td className="px-3 py-3"><SheetOutcomeBadge outcome={sheet.outcome} /></td>
                              <td className="max-w-[420px] px-3 py-3 text-xs text-muted-foreground">
                                {sheet.outcome === "failed" ? (
                                  <div className="space-y-1">
                                    <p><span className="font-medium text-foreground">{humanize(sheet.stage ?? "processing")}:</span> {sheet.message}</p>
                                    {sheet.details && <p className="font-mono">{sheet.details}</p>}
                                  </div>
                                ) : (
                                  <div className="space-y-1">
                                    <p>Sheet passed planning and validation.</p>
                                    {sheet.records && (
                                      <RecordCountSummary records={sheet.records} mode={displayedRun.mode} />
                                    )}
                                  </div>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}