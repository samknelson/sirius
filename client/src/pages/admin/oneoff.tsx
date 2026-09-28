import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  Database,
  History,
  Loader2,
  Play,
  RefreshCw,
  ShieldCheck,
  Square,
  XCircle,
} from "lucide-react";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { apiRequest, getApiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { oneoffInputRenderers } from "./oneoff-input-registry";

type OneoffConfig = { id: string; pluginId: string; enabled: boolean; name: string };
type OneoffAction = {
  id: string;
  label: string;
  description?: string;
  destructive?: boolean;
  background?: boolean;
};
type OneoffRun = {
  id: string;
  operation: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  output: string | null;
  error: string | null;
  progress: unknown;
  input: unknown;
};
type StatusResponse = {
  rowCount: number;
  tableExists: boolean;
  activeRun: unknown;
  blockedByOtherConfiguration?: boolean;
};
type PreflightResponse = {
  message: string;
  rowCount?: number;
  estimatedDurationMs?: number;
  confirmationToken?: string;
  destructive: boolean;
};
type PreparedRun = {
  configId: string;
  actionId: string;
  input: Record<string, unknown>;
  signature: string;
  result: PreflightResponse;
};

const activeStatuses = new Set(["queued", "pending", "running", "in_progress", "cancelling"]);

function prettyJson(value: unknown): string {
  if (typeof value === "string") {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  return JSON.stringify(value, null, 2) ?? "—";
}

function dateTime(value: string | null | undefined): string {
  if (!value) return "In progress";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function runIsActive(run: OneoffRun | undefined): boolean {
  return !!run && activeStatuses.has(run.status.toLowerCase());
}

function activeRunId(activeRun: unknown): string | null {
  if (typeof activeRun === "string") return activeRun;
  if (!activeRun || typeof activeRun !== "object") return null;
  const item = activeRun as Record<string, unknown>;
  const id = item.runId ?? item.id;
  return typeof id === "string" ? id : null;
}

function StatusPill({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  const success = ["completed", "succeeded", "success"].includes(normalized);
  const failed = ["failed", "error", "interrupted"].includes(normalized);
  const cancelled = ["cancelled", "canceled"].includes(normalized);
  return (
    <Badge
      variant={success ? "default" : failed ? "destructive" : cancelled ? "secondary" : "outline"}
      className="capitalize"
    >
      {status.replaceAll("_", " ")}
    </Badge>
  );
}

export default function OneoffAdminPage() {
  usePageTitle("One-off Jobs");
  const { toast } = useToast();
  const [selectedId, setSelectedId] = useState("");
  const [actionId, setActionId] = useState("");
  const [input, setInput] = useState<Record<string, unknown>>({});
  const [prepared, setPrepared] = useState<PreparedRun | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const [jsonInput, setJsonInput] = useState("{}");

  const configsQuery = useQuery<OneoffConfig[]>({
    queryKey: ["/api/plugins/oneoff/configs"],
    queryFn: () => apiRequest("GET", "/api/plugins/oneoff/configs") as Promise<OneoffConfig[]>,
  });
  const configs = configsQuery.data ?? [];
  const enabledConfigs = useMemo(() => configs.filter((config) => config.enabled), [configs]);
  const selectedConfig = enabledConfigs.find((config) => config.id === selectedId);
  const actionsQuery = useQuery<OneoffAction[]>({
    queryKey: ["/api/oneoff/configs", selectedId, "actions"],
    queryFn: () => apiRequest("GET", `/api/oneoff/configs/${encodeURIComponent(selectedId)}/actions`) as Promise<OneoffAction[]>,
    enabled: !!selectedId,
  });
  const actions = actionsQuery.data ?? [];
  const selectedAction = actions.find((item) => item.id === actionId) ?? actions[0];
  const PluginActionRenderer = selectedConfig && selectedAction
    ? oneoffInputRenderers[selectedConfig.pluginId]?.[selectedAction.id]
    : undefined;
  const signature = JSON.stringify({ selectedId, actionId: selectedAction?.id ?? "", input, jsonInput });
  const latestSignature = useRef(signature);
  latestSignature.current = signature;

  const invalidatePreflight = () => {
    setPrepared(null);
    setConfirmOpen(false);
  };
  const submittedInput = (): { value?: Record<string, unknown>; error?: string } => {
    if (!selectedConfig || !selectedAction) return { error: "Select a configuration and operation first." };
    if (selectedConfig.pluginId === "oneoff-test") {
      if (selectedAction.id !== "run-batch") return { value: {} };
      const count = Number(input.count ?? 300);
      const delayMs = Number(input.delayMs ?? 1000);
      if (!Number.isInteger(count) || count < 1 || count > 1000) return { error: "Batch count must be a whole number from 1 to 1,000." };
      if (!Number.isInteger(delayMs) || delayMs < 1 || delayMs > 60000) return { error: "Delay must be a whole number from 1 to 60,000 ms." };
      return { value: { count, delayMs } };
    }
    try {
      const parsed: unknown = JSON.parse(jsonInput);
      if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
        return { error: "Plugin input must be a JSON object." };
      }
      return { value: parsed as Record<string, unknown> };
    } catch {
      return { error: "Enter a valid JSON object before preflight." };
    }
  };

  const statusQuery = useQuery<StatusResponse>({
    queryKey: ["/api/oneoff/configs", selectedId, "status"],
    queryFn: () => apiRequest("GET", `/api/oneoff/configs/${encodeURIComponent(selectedId)}/status`) as Promise<StatusResponse>,
    enabled: !!selectedId,
    refetchInterval: 4000,
  });
  const historyQuery = useQuery<OneoffRun[]>({
    queryKey: ["/api/oneoff/configs", selectedId, "runs"],
    queryFn: () => apiRequest("GET", `/api/oneoff/configs/${encodeURIComponent(selectedId)}/runs`) as Promise<OneoffRun[]>,
    enabled: !!selectedId,
    refetchInterval: 5000,
  });

  const activeId = activeRunId(statusQuery.data?.activeRun);
  const activeOperation = statusQuery.data?.activeRun &&
    typeof statusQuery.data.activeRun === "object" &&
    "operation" in statusQuery.data.activeRun
      ? statusQuery.data.activeRun.operation
      : undefined;
  const currentRunId = activeId ?? selectedRun;
  const runQuery = useQuery<OneoffRun>({
    queryKey: ["/api/oneoff/runs", currentRunId],
    queryFn: () => apiRequest("GET", `/api/oneoff/runs/${encodeURIComponent(currentRunId!)}`) as Promise<OneoffRun>,
    enabled: !!currentRunId,
    refetchInterval: (query) => runIsActive(query.state.data) ? 2000 : false,
  });

  const preflightMutation = useMutation({
    mutationFn: async (variables: Omit<PreparedRun, "result">) => {
      return apiRequest("POST", `/api/oneoff/configs/${encodeURIComponent(variables.configId)}/preflight`, {
        action: variables.actionId,
        input: variables.input,
      }) as Promise<PreflightResponse>;
    },
    onSuccess: (result, variables) => {
      if (variables.signature !== latestSignature.current) return;
      setPrepared({ ...variables, result });
      setConfirmOpen(true);
    },
    onError: (error: unknown) => toast({ title: "Preflight failed", description: getApiErrorMessage(error, "The job could not be preflighted."), variant: "destructive" }),
  });
  const runMutation = useMutation({
    mutationFn: async (variables: PreparedRun) => {
      return apiRequest("POST", `/api/oneoff/configs/${encodeURIComponent(variables.configId)}/run`, {
        action: variables.actionId,
        input: variables.input,
        ...(variables.result.confirmationToken ? { confirmationToken: variables.result.confirmationToken } : {}),
      }) as Promise<{ runId: string }>;
    },
    onSuccess: ({ runId }) => {
      setSelectedRun(runId);
      setConfirmOpen(false);
      setPrepared(null);
      void historyQuery.refetch();
      void statusQuery.refetch();
      toast({ title: "Job started", description: `Run ${runId} has been submitted.` });
    },
    onError: (error: unknown) => toast({ title: "Could not start job", description: getApiErrorMessage(error, "The run was rejected."), variant: "destructive" }),
  });
  const cancelMutation = useMutation({
    mutationFn: async (runId: string) => apiRequest("POST", `/api/oneoff/runs/${encodeURIComponent(runId)}/cancel`),
    onSuccess: () => {
      toast({ title: "Cancellation requested", description: "The run will stop at a safe interruption point." });
      void statusQuery.refetch();
      void historyQuery.refetch();
    },
    onError: (error: unknown) => toast({ title: "Cancellation failed", description: getApiErrorMessage(error, "The run could not be cancelled."), variant: "destructive" }),
  });

  const currentRun = runQuery.data;
  const selectConfig = (value: string) => {
    invalidatePreflight();
    setSelectedId(value);
    setActionId("");
    setSelectedRun(null);
    setInput({});
    setJsonInput("{}");
  };
  const requestPreflight = () => {
    const result = submittedInput();
    if (result.error || !result.value || !selectedAction) {
      toast({ title: "Review inputs", description: result.error ?? "Choose an operation before continuing.", variant: "destructive" });
      return;
    }
    const next = {
      configId: selectedId,
      actionId: selectedAction.id,
      input: result.value,
      signature,
    };
    setPrepared(null);
    preflightMutation.mutate(next);
  };
  const startRun = () => {
    if (!prepared || !selectedConfig || !selectedAction
      || prepared.configId !== selectedConfig.id
      || prepared.actionId !== selectedAction.id
      || prepared.signature !== latestSignature.current) {
      invalidatePreflight();
      toast({ title: "Preflight expired", description: "Input changed. Run preflight again before execution.", variant: "destructive" });
      return;
    }
    runMutation.mutate(prepared);
  };

  return (
    <main className="mx-auto w-full max-w-7xl space-y-7 px-4 py-6 md:px-8 md:py-9">
      <header className="relative overflow-hidden rounded-2xl border border-[#b8c9c3] bg-[#eaf1ee] px-5 py-7 md:px-9 md:py-9">
        <div className="absolute right-0 top-0 h-full w-1/3 bg-[radial-gradient(ellipse_at_top_right,rgba(204,127,81,0.19),transparent_68%)]" />
        <div className="relative flex flex-col justify-between gap-6 md:flex-row md:items-end">
          <div className="max-w-2xl">
            <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.19em] text-[#54736a]">
              <ShieldCheck className="h-4 w-4" /> Operations / Controlled execution
            </div>
            <h1 className="text-3xl font-semibold tracking-tight text-[#1b342d] md:text-4xl">One-off jobs</h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-[#50645e]">
              Deliberate, auditable execution for enabled plugin configurations. Every run begins with a preflight.
            </p>
          </div>
          <div className="flex items-center gap-2 self-start rounded-full border border-[#c5d3ce] bg-[#f7faf8] px-3 py-2 text-xs text-[#3e5d53] md:self-auto">
            <span className="h-2 w-2 rounded-full bg-[#628b78]" />
            Status refreshes every 4 seconds
          </div>
        </div>
      </header>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
        <Card className="border-[#d8e0dc] shadow-[0_12px_32px_rgba(39,65,56,0.05)]">
          <CardHeader className="pb-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2 text-lg"><Play className="h-4 w-4 text-[#b66a42]" /> Prepare a run</CardTitle>
                <CardDescription className="mt-1">Choose an enabled configuration, then inspect its preflight.</CardDescription>
              </div>
              <span className="rounded-md bg-[#f3e6dc] px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-[#89573b]">One-time operation</span>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="oneoff-config">Enabled configuration</Label>
                <Select value={selectedId} onValueChange={selectConfig}>
                  <SelectTrigger id="oneoff-config" aria-label="Select enabled configuration">
                    <SelectValue placeholder={configsQuery.isLoading ? "Loading configurations…" : "Select a configuration"} />
                  </SelectTrigger>
                  <SelectContent>
                    {enabledConfigs.map((config) => (
                      <SelectItem value={config.id} key={config.id}>{config.name} <span className="text-muted-foreground">· {config.pluginId}</span></SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {configsQuery.isError && <p role="alert" className="text-xs text-destructive">Could not load configurations. <button className="underline" onClick={() => void configsQuery.refetch()}>Retry</button></p>}
                {!configsQuery.isLoading && !configsQuery.isError && enabledConfigs.length === 0 && (
                  <p className="text-xs leading-5 text-muted-foreground">
                    No enabled one-off configurations are available.{" "}
                    <Link href="/admin/plugin-configs/oneoff" className="font-medium text-[#42675a] underline underline-offset-2 hover:text-[#29483d]">
                      Review One-off plugin configurations
                    </Link>
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="oneoff-action">Operation</Label>
                <Select value={selectedAction?.id ?? ""} onValueChange={(value) => { invalidatePreflight(); setActionId(value); setInput({}); setJsonInput("{}"); }}>
                  <SelectTrigger id="oneoff-action" disabled={!selectedId || actionsQuery.isLoading || actions.length === 0}><SelectValue placeholder={actionsQuery.isLoading ? "Loading operations…" : "Select an operation"} /></SelectTrigger>
                  <SelectContent>
                    {actions.map((item) => (
                      <SelectItem value={item.id} key={item.id}>
                        {item.label}{item.background ? " · Background" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedAction?.description && <p className="text-xs leading-5 text-muted-foreground">{selectedAction.description}</p>}
                {selectedAction?.destructive && <p className="flex items-center gap-1.5 text-xs font-medium text-[#9a5438]"><AlertTriangle className="h-3.5 w-3.5" />Destructive action</p>}
              </div>
            </div>

            {selectedConfig && selectedAction && (
              selectedConfig.pluginId === "oneoff-test" ? (
                PluginActionRenderer ? (
                  <PluginActionRenderer
                    value={input}
                    onChange={(value) => { invalidatePreflight(); setInput(value); }}
                  />
                ) : null
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="oneoff-input">Plugin input (JSON)</Label>
                  <textarea id="oneoff-input" value={jsonInput} onChange={(event) => { invalidatePreflight(); setJsonInput(event.target.value); }} rows={4} spellCheck={false} className="w-full rounded-lg border border-input bg-background px-3 py-2 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-describedby="oneoff-input-help" />
                  <p id="oneoff-input-help" className="text-xs text-muted-foreground">Enter a JSON object. The server validates inputs for this plugin.</p>
                </div>
              )
            )}

            {actionsQuery.isError && selectedId && (
              <div role="alert" className="flex items-center justify-between rounded-lg border border-[#e5c4b4] bg-[#fbf2ed] px-3 py-2 text-sm text-[#8c4d36]">
                Operations could not be loaded.
                <Button variant="ghost" size="sm" onClick={() => void actionsQuery.refetch()}>Retry</Button>
              </div>
            )}
            {actionsQuery.isSuccess && selectedId && actions.length === 0 && (
              <p className="rounded-lg border border-dashed border-[#cbd8d2] px-4 py-3 text-sm text-muted-foreground">This configuration has no available operations.</p>
            )}

            {selectedConfig && (
              <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border/70 pt-4">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Database className="h-4 w-4" />
                  {statusQuery.isLoading ? "Reading table status…" : statusQuery.data?.tableExists
                    ? `${Number(statusQuery.data.rowCount).toLocaleString()} rows in table`
                    : statusQuery.data ? "Table is not present" : "Table count unavailable"}
                </div>
                <Button onClick={requestPreflight} disabled={!selectedId || !selectedAction || actionsQuery.isLoading || actionsQuery.isError || preflightMutation.isPending || runMutation.isPending || Boolean(activeId) || statusQuery.data?.blockedByOtherConfiguration}>
                  {preflightMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
                  {preflightMutation.isPending ? "Checking…" : "Run preflight"}
                </Button>
              </div>
            )}
            {statusQuery.isError && selectedConfig && (
              <div role="alert" className="flex items-center justify-between rounded-lg border border-[#e5c4b4] bg-[#fbf2ed] px-3 py-2 text-sm text-[#8c4d36]">
                Status could not be loaded.
                <Button variant="ghost" size="sm" onClick={() => void statusQuery.refetch()}><RefreshCw className="mr-2 h-4 w-4" />Retry</Button>
              </div>
            )}
            {statusQuery.data?.blockedByOtherConfiguration && (
              <p role="status" className="text-xs text-[#795c35]">
                Another configuration of this plugin is running. Wait for it to finish before starting a new run.
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="border-[#d8e0dc] shadow-[0_12px_32px_rgba(39,65,56,0.05)]">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg"><ActivityIcon /> Run monitor</CardTitle>
            <CardDescription>Live execution state, progress, and safe cancellation.</CardDescription>
          </CardHeader>
          <CardContent>
            {!selectedConfig ? (
              <div className="rounded-xl border border-dashed border-[#cbd8d2] bg-[#f7f9f7] px-5 py-8 text-center">
                <Database className="mx-auto h-6 w-6 text-[#769087]" />
                <p className="mt-3 text-sm font-medium text-[#344e45]">Select a configuration to monitor</p>
                <p className="mt-1 text-xs text-muted-foreground">The live table count and active run appear here.</p>
              </div>
            ) : statusQuery.isLoading ? (
              <div className="space-y-3"><Skeleton className="h-20 w-full" /><Skeleton className="h-12 w-full" /></div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-xl bg-[#edf3ef] p-4">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#678077]">Whole-table count</p>
                    <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-[#244238]">{statusQuery.data?.tableExists ? Number(statusQuery.data.rowCount).toLocaleString() : "—"}</p>
                  </div>
                  <div className="rounded-xl bg-[#f5eee8] p-4">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#92705b]">Table state</p>
                    <p className="mt-2 text-sm font-semibold text-[#604b3e]">{statusQuery.data?.tableExists ? "Available" : "Not created"}</p>
                    <p className="mt-1 text-[11px] text-[#927d6f]">{statusQuery.data?.tableExists ? "Count includes all rows" : "No table detected"}</p>
                  </div>
                </div>
                {activeId ? (
                  <div className="rounded-xl border border-[#ddc5ae] bg-[#fbf6f0] p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span className="relative flex h-2.5 w-2.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#c57a4f] opacity-40" /><span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#b66a42]" /></span>
                        <p className="text-sm font-semibold text-[#68452f]">Run in progress</p>
                      </div>
                      {activeOperation !== "preflight" && (
                        <Button variant="outline" size="sm" disabled={cancelMutation.isPending} onClick={() => cancelMutation.mutate(activeId)} className="border-[#cda88d] text-[#794d34] hover:bg-[#f2e4d9]">
                          {cancelMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Square className="mr-2 h-3.5 w-3.5" />}Cancel run
                        </Button>
                      )}
                    </div>
                    <p className="mt-2 break-all font-mono text-[11px] text-[#886a56]">{activeId}</p>
                    {currentRun?.progress !== undefined && <pre className="mt-3 max-h-36 overflow-auto rounded-lg bg-[#f3e9df] p-3 font-mono text-[11px] text-[#624a39]">{prettyJson(currentRun.progress)}</pre>}
                  </div>
                ) : currentRun ? (
                  <div className="rounded-xl border border-[#d8e0dc] bg-[#f7f9f7] p-4">
                    <div className="flex items-center justify-between gap-2"><p className="text-sm font-semibold text-[#344e45]">Most recent run</p><StatusPill status={currentRun.status} /></div>
                    <p className="mt-2 font-mono text-[11px] text-muted-foreground">{currentRun.id}</p>
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-[#cbd8d2] px-4 py-5 text-center text-sm text-muted-foreground">No active run. Preflight when you are ready.</div>
                )}
                {currentRun?.error && <div role="alert" className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive"><AlertTriangle className="h-4 w-4 shrink-0" />{currentRun.error}</div>}
                {currentRun?.status?.toLowerCase() === "interrupted" && <div role="status" className="flex gap-2 rounded-lg border border-[#e3c49f] bg-[#fbf5eb] p-3 text-xs text-[#795c35]"><AlertTriangle className="h-4 w-4 shrink-0" />This run was interrupted. Review its progress and output before starting another run.</div>}
                <p className="flex items-center gap-2 text-[11px] text-muted-foreground"><Clock3 className="h-3.5 w-3.5" />Polling is automatic; status and history remain available after navigation.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="overflow-hidden border-[#d8e0dc] shadow-[0_12px_32px_rgba(39,65,56,0.04)]">
        <CardHeader className="border-b border-[#e3e9e5] bg-[#f7f9f7]">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg"><History className="h-4 w-4 text-[#648174]" /> Run history</CardTitle>
              <CardDescription className="mt-1">Execution records and retained output for the selected configuration.</CardDescription>
            </div>
            {selectedConfig && <Button variant="ghost" size="sm" onClick={() => void historyQuery.refetch()} aria-label="Refresh run history"><RefreshCw className="h-4 w-4" /></Button>}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {!selectedConfig ? (
            <div className="px-6 py-10 text-center text-sm text-muted-foreground">Choose a configuration to view its run history.</div>
          ) : historyQuery.isLoading ? (
            <div className="space-y-3 p-5"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div>
          ) : historyQuery.isError ? (
            <div role="alert" className="px-6 py-8 text-center text-sm text-destructive">History failed to load. <button className="underline" onClick={() => void historyQuery.refetch()}>Try again</button></div>
          ) : (historyQuery.data ?? []).length === 0 ? (
            <div className="px-6 py-10 text-center">
              <CheckCircle2 className="mx-auto h-6 w-6 text-[#7f9a8d]" />
              <p className="mt-3 text-sm font-medium text-[#344e45]">No runs recorded</p>
              <p className="mt-1 text-xs text-muted-foreground">Completed and interrupted runs will appear here.</p>
            </div>
          ) : (
            <div className="divide-y divide-[#e8ede9]">
              {(historyQuery.data ?? []).map((run) => (
                <details key={run.id} className="group">
                  <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4 hover:bg-[#f7f9f7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring md:px-6">
                    <span className="min-w-[130px] flex-1">
                      <span className="block text-sm font-medium text-[#30483f]">{actions.find((item) => item.id === run.operation)?.label ?? run.operation.replaceAll("-", " ")}</span>
                      <span className="mt-1 block font-mono text-[10px] text-muted-foreground">{run.id}</span>
                    </span>
                    <StatusPill status={run.status} />
                    <span className="min-w-[150px] text-xs text-muted-foreground">{dateTime(run.startedAt)}</span>
                    <span className="flex items-center gap-2 text-xs text-[#567064]">{run.error ? <XCircle className="h-4 w-4 text-destructive" /> : <ArrowRight className="h-4 w-4" />}Details</span>
                  </summary>
                  <div className="grid gap-4 border-t border-[#e8ede9] bg-[#fbfcfb] px-5 py-5 md:grid-cols-2 md:px-6">
                    <div className="space-y-3">
                      <p className="text-xs text-muted-foreground">Started <span className="ml-2 text-foreground">{dateTime(run.startedAt)}</span></p>
                      <p className="text-xs text-muted-foreground">Ended <span className="ml-2 text-foreground">{dateTime(run.completedAt)}</span></p>
                      {run.error && <p className="rounded-md border border-destructive/25 bg-destructive/5 p-3 text-xs text-destructive">{run.error}</p>}
                      <div>
                        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Input</p>
                        <pre className="max-h-40 overflow-auto rounded-lg bg-[#edf2ef] p-3 font-mono text-[11px] text-[#3d554c]">{prettyJson(run.input)}</pre>
                      </div>
                    </div>
                    <div className="space-y-3">
                      <div>
                        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Progress</p>
                        <pre className="max-h-40 overflow-auto rounded-lg bg-[#edf2ef] p-3 font-mono text-[11px] text-[#3d554c]">{prettyJson(run.progress)}</pre>
                      </div>
                      <div>
                        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Output</p>
                        <pre className="max-h-52 overflow-auto rounded-lg bg-[#edf2ef] p-3 font-mono text-[11px] text-[#3d554c]">{run.output ? prettyJson(run.output) : "No output recorded."}</pre>
                      </div>
                      {run.operation !== "preflight" && runIsActive(run) && <Button variant="outline" size="sm" onClick={() => cancelMutation.mutate(run.id)} disabled={cancelMutation.isPending}><Square className="mr-2 h-3.5 w-3.5" />Cancel run</Button>}
                    </div>
                  </div>
                </details>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={confirmOpen} onOpenChange={(open) => { setConfirmOpen(open); if (!open) setPrepared(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-[#b66a42]" />
              {prepared?.result.destructive ? "Confirm destructive operation" : "Confirm operation"}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm">
                <p>{prepared?.result.message || "Review the preflight result before execution."}</p>
                <div className="grid grid-cols-2 gap-3 rounded-lg bg-muted/60 p-3 text-xs">
                  <div><span className="block text-muted-foreground">Configuration</span><strong className="mt-1 block text-foreground">{selectedConfig?.name}</strong></div>
                  <div><span className="block text-muted-foreground">Operation</span><strong className="mt-1 block text-foreground">{selectedAction?.label ?? prepared?.actionId}</strong></div>
                  <div><span className="block text-muted-foreground">Whole-table rows</span><strong className="mt-1 block text-foreground">{prepared?.result.rowCount === undefined ? "Not provided" : Number(prepared.result.rowCount).toLocaleString()}</strong></div>
                  <div><span className="block text-muted-foreground">Estimate</span><strong className="mt-1 block text-foreground">{prepared?.result.estimatedDurationMs === undefined ? "Not provided" : `${(prepared.result.estimatedDurationMs / 1000).toFixed(1)} sec`}</strong></div>
                </div>
                {prepared?.result.destructive && <p className="rounded-md border border-[#e4c1a4] bg-[#fcf3ea] p-3 text-xs font-medium text-[#86532f]">This action is marked destructive. Proceed only if the target and expected impact are understood.</p>}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={runMutation.isPending}>Review again</AlertDialogCancel>
            <AlertDialogAction onClick={(event) => { event.preventDefault(); startRun(); }} disabled={runMutation.isPending}>
              {runMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {runMutation.isPending ? "Starting…" : "Confirm and execute"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}

function ActivityIcon() {
  return <RefreshCw className="h-4 w-4 text-[#648174]" />;
}