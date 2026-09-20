import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  title: string;
  sourceStatus: StatusName;
  outcome: SheetOutcome;
  stage?: RunStage;
  message?: string;
  details?: string;
};
type RunStatus = {
  status: StatusName;
  label: string;
  fetched: number;
  valid: number;
  created: number;
  updated: number;
  failed: number;
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
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>{outcome.fetched} fetched</span>
          <span>{outcome.valid} valid</span>
          <span>{outcome.created} {mode === "test" ? "would create" : "created"}</span>
          <span>{outcome.updated} {mode === "test" ? "would update" : "updated"}</span>
          {outcome.failed > 0 && <span className="font-medium text-destructive">{outcome.failed} failed</span>}
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
  const statusQuery = useQuery<StatusResponse>({ queryKey: [STATUS_KEY] });
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

  const busy = runMutation.isPending || resetMutation.isPending;
  const outcomes = useMemo(() => new Map(latestRun?.statuses.map((item) => [item.status, item]) ?? []), [latestRun]);
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
              disabled={busy}
              data-testid="input-import-limit"
            />
            <p className="text-xs text-muted-foreground">1–100 records per status; default 100.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => runMutation.mutate({ mode: "test" })} disabled={busy || statusQuery.isLoading} data-testid="button-import-test">
              {runMutation.isPending && runMutation.variables?.mode === "test" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
              Run test
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" disabled={busy || statusQuery.isLoading} data-testid="button-import-live">
                  <ShieldAlert className="mr-2 h-4 w-4" /> Run live
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Run the live Freeman import?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This writes EDLS records and may update existing records. It will process up to {validLimit} records per status. Confirm only after reviewing the paging warning and test results.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => runMutation.mutate({ mode: "live" })}>Run live import</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" disabled={busy} data-testid="button-import-reset">
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
              mode={latestRun?.mode}
            />
          ))}
        </div>

        {latestRun && (
          <div className="space-y-4 rounded-md border p-3" data-testid="card-import-outcome">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant={latestRun.mode === "live" ? "destructive" : "secondary"}>{latestRun.mode === "live" ? "LIVE" : "TEST"}</Badge>
              <span className="font-medium">Latest outcome</span>
              <span className="text-xs text-muted-foreground">started {formatDate(latestRun.startedAt)} · limit {latestRun.limit} · {Math.round(latestRun.durationMs / 100) / 10}s</span>
            </div>
            <div className="space-y-3">
              {latestRun.statuses.map((item) => (
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
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span>{item.fetched} fetched</span>
                      <span>{item.valid} succeeded</span>
                      <span>{item.created} {latestRun.mode === "test" ? "would create" : "created"}</span>
                      <span>{item.updated} {latestRun.mode === "test" ? "would update" : "updated"}</span>
                      <span className={item.failed ? "font-medium text-destructive" : ""}>{item.failed} failed</span>
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
                              <td className="max-w-[260px] px-3 py-3 font-medium">{sheet.title}</td>
                              <td className="px-3 py-3 font-mono text-xs">{sheet.nid ?? "Missing"}</td>
                              <td className="px-3 py-3"><SheetOutcomeBadge outcome={sheet.outcome} /></td>
                              <td className="max-w-[420px] px-3 py-3 text-xs text-muted-foreground">
                                {sheet.outcome === "failed" ? (
                                  <div className="space-y-1">
                                    <p><span className="font-medium text-foreground">{humanize(sheet.stage ?? "processing")}:</span> {sheet.message}</p>
                                    {sheet.details && <p className="font-mono">{sheet.details}</p>}
                                  </div>
                                ) : (
                                  <span>Sheet passed planning and validation.</span>
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