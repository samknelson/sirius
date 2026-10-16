import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle, CheckCircle2, ChevronLeft, ChevronRight,
  ClipboardList, Loader2, Plus, RefreshCw, Settings2, Trash2, Users, XCircle,
} from "lucide-react";
import { getCommStatusLabel } from "@shared/commStatus";
import type {
  ComplianceView, ResolvedBenefitPeriod, WorkerCommsDefinition, WorkerCommsDefinitionInput,
  WorkerCommsOptions, WorkerCommsReport,
} from "@shared/worker-comms-compliance";
import { resolveBenefitPeriod } from "@shared/worker-comms-compliance";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ListBulkAction } from "@/components/bulk/list-bulk-action";
import { CommsDefinitionEditor } from "@/components/workers/comms-definition-editor";
import { apiRequest, getApiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { formatYmdMonth } from "@shared/utils/date";

const PAGE_SIZE = 50;
const REPORT_KEY = "/api/worker-comms-compliance/report";

function formatMonth(month: string) {
  // A month is a calendar value, not an instant in the viewer's zone.
  return formatYmdMonth(`${month}-01`);
}

function reportUrl(id: string, view: ComplianceView, page: number) {
  const params = new URLSearchParams({ view, page: String(page), pageSize: String(PAGE_SIZE) });
  return `/api/worker-comms-compliance/definitions/${encodeURIComponent(id)}/report?${params}`;
}

function statusLabel(value: string | null) {
  return value ? getCommStatusLabel(value) : "No matching record";
}

function Metric({ label, value, tone }: { label: string; value: number; tone: "neutral" | "good" | "missing" }) {
  return (
    <div className={cn("rounded-lg border p-4", tone === "good" ? "border-emerald-900/10 bg-emerald-50/80" : tone === "missing" ? "border-amber-900/10 bg-amber-50/80" : "border-border bg-card")}>
      <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</div>
      <div className="mt-2 font-mono text-3xl font-semibold tracking-tight">{value.toLocaleString()}</div>
    </div>
  );
}

export default function WorkerCommsCompliance() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const searchParams = useMemo(() => new URLSearchParams(search), [search]);
  const requestedDefinition = searchParams.get("definitionId") ?? "";
  const requestedView = searchParams.get("view");
  const view: ComplianceView = requestedView === "with" || requestedView === "without" ? requestedView : "all";
  const rawPage = Number(searchParams.get("page"));
  const requestedPage = Number.isInteger(rawPage) && rawPage >= 1 && rawPage <= 1000000 ? rawPage : 1;
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isSelectingAll, setIsSelectingAll] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingDefinition, setEditingDefinition] = useState<WorkerCommsDefinition | null>(null);
  const [deletingDefinition, setDeletingDefinition] = useState<WorkerCommsDefinition | null>(null);

  const definitionsQuery = useQuery<WorkerCommsDefinition[]>({
    queryKey: ["/api/worker-comms-compliance/definitions"],
    queryFn: () => apiRequest("GET", "/api/worker-comms-compliance/definitions"),
  });
  const optionsQuery = useQuery<WorkerCommsOptions>({
    queryKey: ["/api/worker-comms-compliance/options"],
    queryFn: () => apiRequest("GET", "/api/worker-comms-compliance/options"),
  });
  const definitions = definitionsQuery.data ?? [];
  const activeDefinition = definitions.find((definition) => definition.id === requestedDefinition) ?? definitions[0];
  const page = activeDefinition?.id === requestedDefinition ? requestedPage : 1;

  useEffect(() => {
    if (!definitionsQuery.isSuccess) return;
    const first = definitionsQuery.data?.[0];
    if (!requestedDefinition && !first) return;
    const params = new URLSearchParams(search);
    let changed = false;
    if (!requestedDefinition || !definitions.some((definition) => definition.id === requestedDefinition)) {
      if (first) params.set("definitionId", first.id);
      else params.delete("definitionId");
      changed = true;
    }
    if (requestedView !== "all" && requestedView !== "with" && requestedView !== "without") {
      params.set("view", "all");
      changed = true;
    }
    if (changed) {
      const nextSearch = params.toString();
      const currentSearch = search.startsWith("?") ? search.slice(1) : search;
      if (nextSearch !== currentSearch) {
        navigate(`/workers/comms-compliance${nextSearch ? `?${nextSearch}` : ""}`, { replace: true });
      }
    }
  }, [definitions, definitionsQuery.data, definitionsQuery.isSuccess, navigate, requestedDefinition, requestedView, search]);

  const definitionSignature = useMemo(() => JSON.stringify(activeDefinition ?? null), [activeDefinition]);
  const selectionContext = `${definitionSignature}:${view}`;
  const selectionContextRef = useRef(selectionContext);
  selectionContextRef.current = selectionContext;
  useEffect(() => {
    setSelectedIds(new Set());
  }, [definitionSignature, view]);

  const reportQuery = useQuery<WorkerCommsReport>({
    queryKey: [REPORT_KEY, definitionSignature, view, page, PAGE_SIZE],
    queryFn: () => apiRequest("GET", reportUrl(activeDefinition!.id, view, page)),
    enabled: !!activeDefinition,
  });
  const report = reportQuery.data;
  let resolvedBenefitPeriod: ResolvedBenefitPeriod | undefined;
  if (report && activeDefinition) {
    resolvedBenefitPeriod = report.benefitPeriod;
    if (!resolvedBenefitPeriod) {
      try {
        resolvedBenefitPeriod = resolveBenefitPeriod(activeDefinition.population, report.benefitMonth);
      } catch {
        resolvedBenefitPeriod = undefined;
      }
    }
  }
  const rows = report?.rows ?? [];
  const total = report?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const reportReady = !!report
    && report.definition.id === activeDefinition?.id
    && JSON.stringify(report.definition) === definitionSignature
    && report.page === page
    && !reportQuery.isFetching
    && !reportQuery.isError;
  const visibleSelectedCount = rows.filter((row) => selectedIds.has(row.contactId)).length;
  const canBulk = optionsQuery.data?.canBulk ?? false;
  const canManage = optionsQuery.data?.canManage ?? false;
  const reportTagLabel = activeDefinition
    ? optionsQuery.data?.tags.find((tag) => tag.id === activeDefinition.commTagId)?.name ?? activeDefinition.commTagId
    : "";
  const reportStatuses = activeDefinition?.statuses.map(getCommStatusLabel).join(", ") ?? "";
  const reportMedium = activeDefinition?.medium
    ? ({ email: "Email", sms: "SMS", postal: "Postal", inapp: "In-app" } as const)[activeDefinition.medium]
    : "Any medium";
  const reportSentRange = activeDefinition?.sentFrom || activeDefinition?.sentThrough
    ? `${activeDefinition.sentFrom || "Any date"} – ${activeDefinition.sentThrough || "Any date"}`
    : "Any sent date";

  const updateUrl = useCallback((next: { definitionId?: string; view?: ComplianceView; page?: number }) => {
    const params = new URLSearchParams(search);
    if (next.definitionId !== undefined) {
      if (next.definitionId) params.set("definitionId", next.definitionId);
      else params.delete("definitionId");
    }
    if (next.view !== undefined) params.set("view", next.view);
    if (next.page !== undefined) {
      if (next.page <= 1) params.delete("page");
      else params.set("page", String(next.page));
    }
    if (next.definitionId !== undefined || next.view !== undefined) params.delete("page");
    navigate(`/workers/comms-compliance?${params.toString()}`);
  }, [navigate, search]);

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["/api/worker-comms-compliance/definitions"] }),
      queryClient.invalidateQueries({ queryKey: [REPORT_KEY] }),
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard-plugins", "worker-comms-compliance"] }),
    ]);
  };

  const createMutation = useMutation({
    mutationFn: (body: WorkerCommsDefinitionInput) => apiRequest("POST", "/api/worker-comms-compliance/definitions", body),
    onSuccess: async (created: WorkerCommsDefinition) => {
      await invalidate();
      setEditorOpen(false);
      setEditingDefinition(null);
      updateUrl({ definitionId: created.id, view: "all", page: 1 });
      toast({ title: "Definition created", description: "The report is ready to review." });
    },
    onError: (error) => toast({ title: "Could not create definition", description: getApiErrorMessage(error, "Try again."), variant: "destructive" }),
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: WorkerCommsDefinitionInput }) => apiRequest("PUT", `/api/worker-comms-compliance/definitions/${encodeURIComponent(id)}`, body),
    onSuccess: async () => {
      await invalidate();
      setEditorOpen(false);
      setEditingDefinition(null);
      setSelectedIds(new Set());
      updateUrl({ page: 1 });
      toast({ title: "Definition saved", description: "The report has been refreshed." });
    },
    onError: (error) => toast({ title: "Could not save definition", description: getApiErrorMessage(error, "Try again."), variant: "destructive" }),
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/worker-comms-compliance/definitions/${encodeURIComponent(id)}`),
    onSuccess: async (_, id) => {
      await invalidate();
      setDeletingDefinition(null);
      const remaining = definitions.filter((definition) => definition.id !== id);
      if (requestedDefinition === id) updateUrl({ definitionId: remaining[0]?.id ?? "", view: "all", page: 1 });
      toast({ title: "Definition deleted" });
    },
    onError: (error) => toast({ title: "Could not delete definition", description: getApiErrorMessage(error, "Try again."), variant: "destructive" }),
  });

  const handleSelectPage = (checked: boolean | "indeterminate") => {
    setSelectedIds((current) => {
      const next = new Set(current);
      rows.forEach((row) => checked ? next.add(row.contactId) : next.delete(row.contactId));
      return next;
    });
  };
  const pageSelected = rows.length > 0 && rows.every((row) => selectedIds.has(row.contactId));
  const selectAllMatching = async () => {
    if (!activeDefinition || !reportReady) return;
    setIsSelectingAll(true);
    const requestContext = selectionContext;
    try {
      const params = new URLSearchParams({ view });
      const result = await apiRequest("GET", `/api/worker-comms-compliance/definitions/${encodeURIComponent(activeDefinition.id)}/contacts?${params}`);
      if (selectionContextRef.current !== requestContext) return;
      setSelectedIds(new Set(result.contactIds));
      toast({ title: "All matching workers selected", description: `${result.total.toLocaleString()} worker${result.total === 1 ? "" : "s"} selected for the current report.` });
    } catch (error) {
      toast({ title: "Could not select all workers", description: getApiErrorMessage(error, "Try again."), variant: "destructive" });
    } finally {
      setIsSelectingAll(false);
    }
  };
  const openEditor = (definition: WorkerCommsDefinition | null) => {
    setEditingDefinition(definition);
    setEditorOpen(true);
  };

  if (definitionsQuery.isLoading || optionsQuery.isLoading) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <PageHeader title="Worker communications compliance" icon={<ClipboardList className="h-4 w-4 text-primary-foreground" />} />
        <main className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6">
          <div className="h-28 animate-pulse rounded-xl bg-muted" />
          <div className="h-20 animate-pulse rounded-xl bg-muted" />
          <div className="h-72 animate-pulse rounded-xl bg-muted" />
        </main>
      </div>
    );
  }

  if (definitionsQuery.isError || optionsQuery.isError) {
    const error = definitionsQuery.error ?? optionsQuery.error;
    return (
      <div className="min-h-screen bg-background text-foreground">
        <PageHeader title="Worker communications compliance" icon={<ClipboardList className="h-4 w-4 text-primary-foreground" />} />
        <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
          <div className="rounded-xl border border-destructive/25 bg-destructive/5 p-6">
            <AlertCircle className="mb-3 h-6 w-6 text-destructive" />
            <h2 className="text-lg font-semibold">Compliance view could not load</h2>
            <p className="mt-1 text-sm text-muted-foreground">{getApiErrorMessage(error, "The server did not return the definitions or lookup choices.")}</p>
            <Button className="mt-5" variant="outline" onClick={() => { definitionsQuery.refetch(); optionsQuery.refetch(); }}><RefreshCw className="mr-2 h-4 w-4" />Try again</Button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <PageHeader
        title="Worker communications compliance"
        icon={<ClipboardList className="h-4 w-4 text-primary-foreground" />}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {canBulk && activeDefinition && reportReady && (
              <ListBulkAction
                selectedContactIds={Array.from(selectedIds)}
                totalMatching={total}
                visibleSelectedCount={visibleSelectedCount}
                onSelectAllMatching={selectAllMatching}
                isSelectingAllMatching={isSelectingAll}
                sourceLabel={activeDefinition.name}
                testIdPrefix="worker-comms-compliance-bulk"
                reportSelection={{ definitionId: activeDefinition.id, view }}
              />
            )}
            {canManage && (
              <Button size="sm" onClick={() => openEditor(null)}><Plus className="mr-2 h-4 w-4" />New definition</Button>
            )}
          </div>
        }
      />

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        {definitions.length === 0 ? (
          <section className="relative overflow-hidden rounded-xl border border-border bg-card p-7 sm:p-10">
            <div className="absolute -right-12 -top-14 h-52 w-52 rounded-full border-[26px] border-primary/5" />
            <div className="relative max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Monthly distribution review</p>
              <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight sm:text-4xl">Make the missing list actionable.</h2>
              <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">
                A definition describes who should receive a notice and which tagged communication records count as evidence. Each definition can use the current benefit month, all past benefit history, a rolling lookback, or a specific date range.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                {canManage ? <Button onClick={() => openEditor(null)}><Plus className="mr-2 h-4 w-4" />Create a definition</Button> : <p className="rounded-md bg-muted px-4 py-3 text-sm text-muted-foreground">Ask a benefits administrator to create the first definition.</p>}
              </div>
            </div>
          </section>
        ) : (
          <>
            <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">Definition</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <div className="flex flex-wrap gap-2">
                      {definitions.map((definition) => (
                        <button key={definition.id} type="button" onClick={() => updateUrl({ definitionId: definition.id, page: 1 })} className={cn("max-w-full truncate rounded-md border px-3 py-2 text-sm font-medium transition-colors", activeDefinition?.id === definition.id ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:bg-accent")}>
                          {definition.name}
                        </button>
                      ))}
                    </div>
                    {canManage && activeDefinition && (
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" aria-label="Edit definition" onClick={() => openEditor(activeDefinition)}><Settings2 className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" aria-label="Delete definition" onClick={() => setDeletingDefinition(activeDefinition)}><Trash2 className="h-4 w-4 text-muted-foreground" /></Button>
                      </div>
                    )}
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {report ? `Benefit history: ${resolvedBenefitPeriod?.label ?? "period unavailable"}. Reference month: ${formatMonth(resolvedBenefitPeriod?.referenceMonth ?? report.benefitMonth)}.` : "Benefit history is evaluated using the report’s reference month."} {activeDefinition?.population.benefitIds.length ? "Any selected benefit overlapping any included month is enough to match." : "Benefits do not restrict this population."} A draft or queue action alone is not evidence: history must show the selected tag and status. Offline does not confirm physical receipt.
                  </p>
                  {activeDefinition && (
                    <div className="mt-3 flex flex-wrap gap-2 text-xs">
                      <span className="rounded-md bg-muted px-2.5 py-1.5"><span className="font-semibold">Tag</span> · {reportTagLabel}</span>
                      <span className="rounded-md bg-muted px-2.5 py-1.5"><span className="font-semibold">Status</span> · {reportStatuses}</span>
                      <span className="rounded-md bg-muted px-2.5 py-1.5"><span className="font-semibold">Medium</span> · {reportMedium}</span>
                      <span className="rounded-md bg-muted px-2.5 py-1.5"><span className="font-semibold">Sent</span> · {reportSentRange}</span>
                    </div>
                  )}
                </div>
                <Button variant="outline" size="sm" onClick={() => reportQuery.refetch()} disabled={reportQuery.isFetching}>
                  {reportQuery.isFetching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                  Refresh report
                </Button>
              </div>
            </section>

            {reportQuery.isError ? (
              <div className="rounded-xl border border-destructive/25 bg-destructive/5 p-6">
                <AlertCircle className="mb-2 h-5 w-5 text-destructive" />
                <h2 className="font-semibold">Report could not be loaded</h2>
                <p className="mt-1 text-sm text-muted-foreground">{getApiErrorMessage(reportQuery.error, "Try refreshing the report.")}</p>
                <Button className="mt-4" size="sm" variant="outline" onClick={() => reportQuery.refetch()}>Retry report</Button>
              </div>
            ) : reportQuery.isLoading || !report ? (
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-3"><div className="h-24 animate-pulse rounded-lg bg-muted" /><div className="h-24 animate-pulse rounded-lg bg-muted" /><div className="h-24 animate-pulse rounded-lg bg-muted" /></div>
                <div className="h-64 animate-pulse rounded-xl bg-muted" />
              </div>
            ) : (
              <>
                <section className="grid gap-3 sm:grid-cols-3">
                  <Metric label="Expected recipients" value={report.counts.population} tone="neutral" />
                  <Metric label="With matching evidence" value={report.counts.with} tone="good" />
                  <Metric label="Missing evidence" value={report.counts.without} tone="missing" />
                </section>

                <section className="overflow-hidden rounded-xl border border-border bg-card">
                  <div className="flex flex-col gap-3 border-b border-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                    <div>
                      <h2 className="font-semibold">Recipient evidence</h2>
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        {total.toLocaleString()} {view === "without" ? "workers need evidence" : view === "with" ? "workers with evidence" : "workers in this view"}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1 rounded-lg bg-muted p-1">
                      {([
                        ["all", "Everyone"],
                        ["with", "With evidence"],
                        ["without", "Missing"],
                      ] as [ComplianceView, string][]).map(([value, label]) => (
                        <button key={value} type="button" onClick={() => updateUrl({ view: value, page: 1 })} className={cn("rounded-md px-3 py-1.5 text-sm transition-colors", view === value ? "bg-card font-semibold text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>{label}</button>
                      ))}
                    </div>
                  </div>
                  {report.counts.population === 0 ? (
                    <div className="p-10 text-center">
                      <Users className="mx-auto h-8 w-8 text-muted-foreground/60" />
                      <h3 className="mt-3 font-semibold">No workers match this definition</h3>
                      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">Review the population criteria. A definition can be edited by an administrator.</p>
                    </div>
                  ) : rows.length === 0 ? (
                    <div className="p-10 text-center text-sm text-muted-foreground">No workers in this view.</div>
                  ) : (
                    <>
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[760px] border-collapse text-left text-sm">
                          <thead className="bg-muted/50 text-xs uppercase tracking-[0.11em] text-muted-foreground">
                            <tr>
                              <th className="w-12 px-4 py-3">
                                <Checkbox checked={pageSelected} disabled={!reportReady} onCheckedChange={handleSelectPage} aria-label="Select all workers on this page" />
                              </th>
                              <th className="px-3 py-3">Worker</th>
                              <th className="px-3 py-3">Sirius ID</th>
                              <th className="px-3 py-3">Evidence status</th>
                              <th className="px-3 py-3">Medium</th>
                              <th className="px-3 py-3">Sent</th>
                              <th className="px-4 py-3 text-right">History</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border">
                            {rows.map((row) => (
                              <tr key={row.contactId} className="group hover:bg-muted/35">
                                <td className="px-4 py-3">
                                  <Checkbox checked={selectedIds.has(row.contactId)} disabled={!reportReady} onCheckedChange={(checked) => setSelectedIds((current) => {
                                    const next = new Set(current);
                                    if (checked) next.add(row.contactId);
                                    else next.delete(row.contactId);
                                    return next;
                                  })} aria-label={`Select ${row.name}`} />
                                </td>
                                <td className="px-3 py-3">
                                  <Link href={`/workers/${encodeURIComponent(row.workerId)}`} className="font-medium text-foreground decoration-primary/40 underline-offset-4 hover:text-primary hover:underline">{row.name}</Link>
                                </td>
                                <td className="px-3 py-3 font-mono text-xs text-muted-foreground">{row.siriusId}</td>
                                <td className="px-3 py-3">
                                  <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium capitalize", row.commId ? "bg-emerald-100 text-emerald-900" : "bg-amber-100 text-amber-950")}>
                                    {row.commId ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                                    {statusLabel(row.status)}
                                  </span>
                                </td>
                                <td className="px-3 py-3 capitalize text-muted-foreground">{row.medium ?? "—"}</td>
                                <td className="px-3 py-3 text-muted-foreground">{row.sent ? new Date(row.sent).toLocaleDateString() : "—"}</td>
                                <td className="px-4 py-3 text-right">
                                  <Link href={`/workers/${encodeURIComponent(row.workerId)}/comm/history`} className="text-xs font-medium text-primary hover:underline">Communication history</Link>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="flex flex-col gap-3 border-t border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                        <p className="text-xs text-muted-foreground">
                          Page {page} of {totalPages} · {selectedIds.size.toLocaleString()} selected across this report
                        </p>
                        <div className="flex items-center gap-2">
                          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => updateUrl({ page: page - 1 })}><ChevronLeft className="mr-1 h-4 w-4" />Previous</Button>
                          <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => updateUrl({ page: page + 1 })}>Next<ChevronRight className="ml-1 h-4 w-4" /></Button>
                        </div>
                      </div>
                    </>
                  )}
                </section>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Population eligibility uses the configured benefit-history period at month granularity; when benefits are selected, one selected benefit in any included month is enough. Evidence matches the configured tag, status, medium, and separate communication sent-date range. For postal or other offline communications, the recorded status is not proof of physical receipt.
                </p>
              </>
            )}
          </>
        )}
      </main>

      <Dialog open={editorOpen} onOpenChange={(open) => { if (!createMutation.isPending && !updateMutation.isPending) setEditorOpen(open); }}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{editingDefinition ? "Edit compliance definition" : "New compliance definition"}</DialogTitle>
            <DialogDescription>Choose the covered population and the communication-history evidence that counts.</DialogDescription>
          </DialogHeader>
          <CommsDefinitionEditor
            definition={editingDefinition}
            options={optionsQuery.data!}
            isSaving={createMutation.isPending || updateMutation.isPending}
            onCancel={() => setEditorOpen(false)}
            onSave={(body) => editingDefinition
              ? updateMutation.mutate({ id: editingDefinition.id, body })
              : createMutation.mutate(body)}
          />
        </DialogContent>
      </Dialog>
      <AlertDialog open={!!deletingDefinition} onOpenChange={(open) => { if (!open && !deleteMutation.isPending) setDeletingDefinition(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this definition?</AlertDialogTitle>
            <AlertDialogDescription>
              “{deletingDefinition?.name}” will be removed. This does not change existing communication history or messages.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={deleteMutation.isPending} onClick={(event) => { event.preventDefault(); if (deletingDefinition) deleteMutation.mutate(deletingDefinition.id); }}>
              {deleteMutation.isPending ? "Deleting…" : "Delete definition"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
