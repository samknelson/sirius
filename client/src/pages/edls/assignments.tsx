import { useEffect, useMemo, useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { Link, useLocation, useSearch } from "wouter";
import { CalendarDays, ChevronLeft, ChevronRight, Download, RotateCw, Users } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AssignmentCommStatusIcon } from "@/components/edls/AssignmentCommStatusIcon";
import { addDaysYmd, formatYmd, getTodayYmd } from "@shared/utils/date";
import {
  acceptedOptions,
  notifiedOptions,
  populationOptions,
  assignmentSheetStatusLabels,
  assignmentExplorerQuerySchema,
  type AssignmentExplorerResult,
  type AssignmentExplorerRow,
} from "@shared/edls-assignment-explorer";
import { getCommStatusLabel } from "@shared/commStatus";
import { liveQueryOptions } from "@/lib/live-query-options";

const PAGE_SIZE = 50;
const sheetStatusStyles: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  request: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  lock: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  reserved: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  trash: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

export default function EdlsAssignmentsPage() {
  const search = useSearch();
  const [, setLocation] = useLocation();
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const today = getTodayYmd();
  const rawDate = params.get("ymd") || today;
  const ymd = assignmentExplorerQuerySchema.shape.ymd.safeParse(rawDate).success ? rawDate : today;
  const accepted = isChoice(params.get("accepted"), acceptedOptions) ? params.get("accepted")! : "all";
  const notified = isChoice(params.get("notified"), notifiedOptions) ? params.get("notified")! : "all";
  const population = isChoice(params.get("population"), populationOptions) ? params.get("population")! : "all";
  const page = Math.max(1, Math.min(1_000_000, Math.floor(Number(params.get("page")) || 1)));
  const [isExporting, setIsExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState("");

  useEffect(() => {
    const normalized = new URLSearchParams(window.location.search);
    let changed = false;
    if (!normalized.has("ymd") || normalized.get("ymd") !== ymd) {
      normalized.set("ymd", ymd);
      changed = true;
    }
    if (normalized.get("pageSize") !== String(PAGE_SIZE)) {
      normalized.set("pageSize", String(PAGE_SIZE));
      changed = true;
    }
    if (changed) setLocation(`/edls/assignments?${normalized.toString()}`, { replace: true });
  }, [ymd, setLocation]);

  const queryString = useMemo(() => {
    const query = new URLSearchParams({ ymd, page: String(page), pageSize: String(PAGE_SIZE) });
    if (accepted !== "all") query.set("accepted", accepted);
    if (notified !== "all") query.set("notified", notified);
    if (population !== "all") query.set("population", population);
    return query.toString();
  }, [ymd, page, accepted, notified, population]);

  const { data, isLoading, isFetching, isError, refetch } = useQuery<AssignmentExplorerResult>({
    ...liveQueryOptions,
    queryKey: ["/api/edls/assignments", queryString],
    queryFn: async () => {
      const response = await fetch(`/api/edls/assignments?${queryString}`, { credentials: "include" });
      if (!response.ok) throw new Error("Unable to load assignments");
      return response.json();
    },
    placeholderData: keepPreviousData,
  });
  const rows = data?.rows ?? [];
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));

  const update = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(window.location.search);
    next.set("ymd", ymd);
    Object.entries(changes).forEach(([key, value]) => value && value !== "all" ? next.set(key, value) : next.delete(key));
    if (!("page" in changes)) next.set("page", "1");
    next.set("pageSize", String(PAGE_SIZE));
    setLocation(`/edls/assignments?${next.toString()}`);
  };

  const downloadCsv = async () => {
    setIsExporting(true);
    setExportMessage("");
    try {
      const response = await fetch(`/api/edls/assignments/export?${queryString.replace(/&page=\d+/, "").replace(/&pageSize=\d+/, "")}`, { credentials: "include" });
      if (!response.ok) {
        let detail = "";
        try { detail = (await response.json()).message || ""; } catch { /* response may not be JSON */ }
        throw new Error(detail || `Export failed (${response.status})`);
      }
      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") || "";
      const filename = disposition.match(/filename\*?=(?:UTF-8''|")?([^";]+)/i)?.[1] ?? `edls-assignments-${ymd}.csv`;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = decodeURIComponent(filename.replace(/"/g, ""));
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setExportMessage("CSV downloaded.");
    } catch (error) {
      setExportMessage(error instanceof Error ? error.message : "Unable to download CSV. Please try again.");
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <>
      <PageHeader title="EDLS Assignment Status" icon={<Users className="h-5 w-5 text-primary-foreground" />} />
      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Daily coordination</p>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight">Assignment status explorer</h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">See who is assigned, who has answered, who was notified, and who remains in the active scheduling population.</p>
          </div>
          <Button onClick={downloadCsv} disabled={isExporting} variant="outline" data-testid="button-edls-assignment-export">
            <Download className="mr-2 h-4 w-4" />{isExporting ? "Preparing CSV…" : "Export full CSV"}
          </Button>
        </div>

        <section className="rounded-lg border bg-card p-4 shadow-sm" aria-label="Assignment filters">
          <div className="mb-4 flex items-center gap-2 text-sm font-medium"><CalendarDays className="h-4 w-4 text-primary" /> Scheduled day</div>
          <div className="flex flex-wrap items-end gap-3">
            <Button variant="outline" size="icon" aria-label="Previous day" onClick={() => update({ ymd: addDaysYmd(ymd, -1) })} data-testid="button-edls-assignment-prev-day"><ChevronLeft className="h-4 w-4" /></Button>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="assignment-date">Date</label>
              <Input id="assignment-date" type="date" value={ymd} onChange={(event) => event.target.value && update({ ymd: event.target.value })} className="w-44" data-testid="input-edls-assignment-date" />
            </div>
            <span className="pb-2 text-sm text-muted-foreground">{formatYmd(ymd, "weekday-short")}</span>
            <Button variant="outline" size="icon" aria-label="Next day" onClick={() => update({ ymd: addDaysYmd(ymd, 1) })} data-testid="button-edls-assignment-next-day"><ChevronRight className="h-4 w-4" /></Button>
            {ymd !== today && <Button variant="ghost" size="sm" className="mb-0.5" onClick={() => update({ ymd: today })} data-testid="button-edls-assignment-today">Today</Button>}
            <div className="ml-auto grid w-full grid-cols-1 gap-3 sm:w-auto sm:grid-cols-3">
              <FilterSelect label="Accepted?" value={accepted} options={acceptedOptions} onChange={(value) => update({ accepted: value })} testId="select-edls-assignment-accepted" />
              <FilterSelect label="Notified?" value={notified} options={notifiedOptions} onChange={(value) => update({ notified: value })} testId="select-edls-assignment-notified" />
              <FilterSelect label="In Population?" value={population} options={populationOptions} onChange={(value) => update({ population: value })} testId="select-edls-assignment-population" />
            </div>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">Filters combine together. Statuses show the current state of assignments scheduled for this date. Refreshes every 30 seconds while visible and when you return.</p>
          <p className="mt-1 text-xs text-muted-foreground">Not Notified means no current linked communication, not that the worker has never been contacted. Pending/unconfirmed includes offline and unrecognized delivery states.</p>
        </section>

        {exportMessage && <Alert variant={exportMessage === "CSV downloaded." ? "default" : "destructive"}><AlertDescription>{exportMessage}</AlertDescription></Alert>}

        <section className="overflow-hidden rounded-lg border bg-card shadow-sm" aria-label="Assignment results">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
            <div><h3 className="font-semibold">Assignments</h3><p className="text-xs text-muted-foreground">{data ? `${data.total.toLocaleString()} matching ${data.total === 1 ? "assignment" : "assignments"}` : "Loading scheduled assignments"}{isFetching && !isLoading ? " · Updating…" : ""}</p></div>
            <Button variant="outline" size="sm" disabled={isFetching} onClick={() => refetch()} aria-label="Refresh assignment statuses"><RotateCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />{isError ? "Retry" : "Refresh"}</Button>
          </div>
          {isLoading ? <div className="space-y-3 p-5"><Skeleton className="h-8 w-full" /><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div>
            : isError ? <div className="p-10 text-center"><p className="font-medium">Assignments could not be loaded.</p><p className="mt-1 text-sm text-muted-foreground">Check your connection, then try again.</p><Button className="mt-4" variant="outline" onClick={() => refetch()}>Try again</Button></div>
            : rows.length === 0 ? <div className="px-5 py-14 text-center"><div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-muted"><Users className="h-5 w-5 text-muted-foreground" /></div><h4 className="mt-4 font-semibold">No matching assignments</h4><p className="mt-1 text-sm text-muted-foreground">Try another date or clear one of the status filters.</p></div>
            : <div className="overflow-x-auto">
              <Table className="min-w-[1050px]">
                <TableHeader><TableRow>
                  <TableHead className="min-w-[190px]">Worker</TableHead><TableHead className="min-w-[180px]">Sheet</TableHead><TableHead>Sheet status</TableHead><TableHead className="min-w-[150px]">Crew / task</TableHead><TableHead>Effective time</TableHead><TableHead>Accepted?</TableHead><TableHead>Notified?</TableHead><TableHead>In population?</TableHead>
                </TableRow></TableHeader>
                <TableBody>{rows.map((row) => <AssignmentRow key={row.id} row={row} />)}</TableBody>
              </Table>
            </div>}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3">
            <span className="text-sm text-muted-foreground">{data && data.total > 0 ? `Showing ${(data.page - 1) * data.pageSize + 1}–${Math.min(data.page * data.pageSize, data.total)} of ${data.total.toLocaleString()}` : data ? "0 results" : ""}</span>
            {data && <div className="flex items-center gap-2"><Button size="sm" variant="outline" disabled={page <= 1 || isFetching} onClick={() => update({ page: String(page - 1) })}><ChevronLeft className="mr-1 h-4 w-4" />Previous</Button><span className="min-w-20 text-center text-sm tabular-nums">Page {Math.min(data.page, totalPages)} of {totalPages}</span><Button size="sm" variant="outline" disabled={page >= totalPages || isFetching} onClick={() => update({ page: String(page + 1) })}>Next<ChevronRight className="ml-1 h-4 w-4" /></Button></div>}
          </div>
        </section>
      </main>
    </>
  );
}

function FilterSelect({ label, value, options, onChange, testId }: { label: string; value: string; options: Record<string, string>; onChange: (value: string) => void; testId: string }) {
  return <div className="space-y-1"><label className="text-xs font-medium text-muted-foreground">{label}</label><Select value={value} onValueChange={onChange}><SelectTrigger className="w-full" data-testid={testId}><SelectValue /></SelectTrigger><SelectContent>{Object.entries(options).map(([key, text]) => <SelectItem key={key} value={key}>{text}</SelectItem>)}</SelectContent></Select></div>;
}

function AssignmentRow({ row }: { row: AssignmentExplorerRow }) {
  const acceptedLabel = row.accepted === null ? "No answer" : row.accepted ? "Yes" : "No";
  const notifiedLabel = notifiedOptions[row.notified];
  const statusKey = row.sheetStatus.toLowerCase();
  const exactCommStatus = row.commStatus ? getCommStatusLabel(row.commStatus) : null;
  return <TableRow>
    <TableCell><div className="font-medium">{row.workerName || "Unknown worker"}</div><div className="text-xs text-muted-foreground">{row.workerIdentifier !== null ? `ID ${row.workerIdentifier}` : "No identifier"}</div></TableCell>
    <TableCell><Link href={`/edls/sheet/${encodeURIComponent(row.sheetId)}`} className="font-medium text-primary hover:underline">{row.sheetTitle || "Untitled sheet"}</Link><div className="text-xs text-muted-foreground">Scheduled {row.ymd}</div></TableCell>
    <TableCell><Badge className={sheetStatusStyles[statusKey] ?? "bg-muted text-muted-foreground"}>{assignmentSheetStatusLabels[statusKey] ?? row.sheetStatus}</Badge></TableCell>
    <TableCell><div className="font-medium">{row.crewTitle || "Crew"}</div><div className="text-xs text-muted-foreground">{row.taskName || "No task"}</div></TableCell>
    <TableCell className="whitespace-nowrap tabular-nums">{formatAssignmentTime(row.startTime)}</TableCell>
    <TableCell><StatusPill label={acceptedLabel} tone={row.accepted === true ? "good" : row.accepted === false ? "bad" : "neutral"} /></TableCell>
    <TableCell><div className="flex items-center gap-2"><StatusPill label={notifiedLabel} tone={row.notified === "sent" ? "good" : row.notified === "failed" ? "bad" : "neutral"} />{row.commId && row.commStatus && <AssignmentCommStatusIcon assignmentId={row.id} commId={row.commId} commStatus={row.commStatus} workerName={row.workerName} />}</div>{exactCommStatus && <div className="mt-1 max-w-32 truncate text-xs text-muted-foreground" title={exactCommStatus}>{exactCommStatus}</div>}</TableCell>
    <TableCell><StatusPill label={row.inPopulation ? "Yes" : "No"} tone={row.inPopulation ? "good" : "neutral"} /></TableCell>
  </TableRow>;
}

function StatusPill({ label, tone }: { label: string; tone: "good" | "bad" | "neutral" }) {
  const styles = tone === "good" ? "border-green-300 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200"
    : tone === "bad" ? "border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200"
    : "border-border bg-muted/60 text-muted-foreground";
  return <Badge variant="outline" className={`whitespace-nowrap ${styles}`}>{label}</Badge>;
}

function formatAssignmentTime(value: string): string {
  const match = value.match(/(?:^|T)(\d{1,2}):(\d{2})/);
  if (!match) return value || "—";
  const hour = Number(match[1]);
  return `${hour % 12 || 12}:${match[2]} ${hour >= 12 ? "PM" : "AM"}`;
}

function isChoice<T extends Record<string, string>>(value: string | null, options: T): value is keyof T & string {
  return value !== null && Object.prototype.hasOwnProperty.call(options, value);
}
