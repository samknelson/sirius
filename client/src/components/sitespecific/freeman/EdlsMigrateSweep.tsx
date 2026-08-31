/**
 * The fetch half of the Freeman EDLS migration screen.
 *
 * Two sweeps and what they produced. The screen's job is to make the copy
 * inspectable and to be honest about it: a sweep that could not read a table
 * in full says so and stages nothing, so "48 sheets" is never shown for a run
 * that only got halfway.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Download,
  Layers,
  Loader2,
  Trash2,
  XCircle,
} from "lucide-react";
import { getApiErrorMessage } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

interface TableRead {
  table: string;
  stoppedBecause: "complete" | "page_cap" | "refused";
  complete: boolean;
  pages: number;
  rowsRead: number;
  rowsKept: number;
  error?: string;
}

interface NodeSweepReport {
  complete: boolean;
  error?: string;
  reads: TableRead[];
  nodesRead: number;
  sheetsFound: number;
  sheetsStaged: number;
  sheetsRemoved: number;
  durationMs: number;
  timestamp: string;
}

interface FieldSweepReport {
  complete: boolean;
  error?: string;
  reads: TableRead[];
  perTable: Array<{
    table: string;
    label: string;
    rowsRead: number;
    rowsKept: number;
    complete: boolean;
    error?: string;
  }>;
  stagedSheets: number;
  sheetsUpdated: number;
  durationMs: number;
  timestamp: string;
}

interface Sources {
  nodeTable: string;
  sheetNodeType: string;
  fieldTables: Array<{ table: string; label: string }>;
}

interface StagedRow {
  id: string;
  nid: string;
  type: string;
  data: {
    node?: Record<string, unknown>;
    nodeFetchedAt?: string;
    fields?: Record<string, unknown[]>;
    fieldsFetchedAt?: string;
  };
}

interface StagedResponse {
  count: number;
  rows: StagedRow[];
}

const STAGED_KEY = "/api/sitespecific/freeman/edls-migrate/staged";

async function post<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: "Request failed" }));
    throw new Error(body.message || `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

function ReadList({ reads }: { reads: TableRead[] }) {
  if (reads.length === 0) return null;
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">Tables read</Label>
      <div className="rounded-md border divide-y">
        {reads.map((read) => (
          <div
            key={read.table}
            className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs"
            data-testid={`row-read-${read.table}`}
          >
            <span className="font-mono">{read.table}</span>
            <span className="flex items-center gap-2 text-muted-foreground">
              <span>{read.rowsRead} rows</span>
              <span>{read.rowsKept} kept</span>
              <span>
                {read.pages} page{read.pages === 1 ? "" : "s"}
              </span>
              {read.complete ? (
                <Badge variant="outline">whole table</Badge>
              ) : (
                <Badge variant="destructive">
                  {read.stoppedBecause === "page_cap" ? "page limit" : "refused"}
                </Badge>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function EdlsMigrateSweep({ configured }: { configured: boolean }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [nodeReport, setNodeReport] = useState<NodeSweepReport | null>(null);
  const [fieldReport, setFieldReport] = useState<FieldSweepReport | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const sourcesQuery = useQuery<Sources>({
    queryKey: ["/api/sitespecific/freeman/edls-migrate/sources"],
  });
  const stagedQuery = useQuery<StagedResponse>({ queryKey: [STAGED_KEY] });

  const nodeSweep = useMutation({
    mutationFn: () => post<NodeSweepReport>("/api/sitespecific/freeman/edls-migrate/sweep/nodes"),
    onSuccess: (report) => {
      setNodeReport(report);
      setFieldReport(null);
      queryClient.invalidateQueries({ queryKey: [STAGED_KEY] });
      toast({
        title: report.complete ? "Sheets fetched" : "Sweep did not finish",
        description: report.complete
          ? `${report.sheetsFound} sheet(s) found in ${report.nodesRead} legacy node(s).` +
            (report.sheetsRemoved > 0
              ? ` ${report.sheetsRemoved} staged row(s) are no longer sheets and were removed.`
              : "")
          : report.error || "Nothing was staged.",
        variant: report.complete ? undefined : "destructive",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: getApiErrorMessage(error, "The sweep could not be run."),
        variant: "destructive",
      });
    },
  });

  const fieldSweep = useMutation({
    mutationFn: () => post<FieldSweepReport>("/api/sitespecific/freeman/edls-migrate/sweep/fields"),
    onSuccess: (report) => {
      setFieldReport(report);
      queryClient.invalidateQueries({ queryKey: [STAGED_KEY] });
      toast({
        title: report.complete ? "Sheet fields fetched" : "Sweep did not finish",
        description: report.complete
          ? `${report.sheetsUpdated} staged sheet(s) updated.`
          : report.error || "Nothing was written.",
        variant: report.complete ? undefined : "destructive",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: getApiErrorMessage(error, "The sweep could not be run."),
        variant: "destructive",
      });
    },
  });

  const clearStaged = useMutation({
    mutationFn: async () => {
      const res = await fetch(STAGED_KEY, { method: "DELETE", credentials: "include" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ message: "Request failed" }));
        throw new Error(body.message || `HTTP ${res.status}`);
      }
      return (await res.json()) as { deleted: number };
    },
    onSuccess: (data) => {
      setNodeReport(null);
      setFieldReport(null);
      queryClient.invalidateQueries({ queryKey: [STAGED_KEY] });
      toast({
        title: "Staging cleared",
        description: `${data.deleted} staged row(s) removed.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: getApiErrorMessage(error, "The staged rows could not be cleared."),
        variant: "destructive",
      });
    },
  });

  const busy = nodeSweep.isPending || fieldSweep.isPending || clearStaged.isPending;
  const staged = stagedQuery.data;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Download className="h-5 w-5" />
            Fetch sheets
          </CardTitle>
          <CardDescription>
            Copies Freeman's legacy sheets into a staging table so they can be looked at.
            Nothing becomes an EDLS sheet here — the staging table is a holding area and
            no other part of this site reads it.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!configured && (
            <Alert data-testid="alert-sweep-not-configured">
              <AlertDescription>
                The connection settings are incomplete, so a sweep would have nothing to
                talk to. Set them first.
              </AlertDescription>
            </Alert>
          )}

          {sourcesQuery.data && (
            <div className="space-y-1 text-xs text-muted-foreground">
              <p data-testid="text-sweep-sources">
                Sheets are nodes of type{" "}
                <span className="font-mono">{sourcesQuery.data.sheetNodeType}</span> in the
                legacy <span className="font-mono">{sourcesQuery.data.nodeTable}</span>{" "}
                table. Their values live in {sourcesQuery.data.fieldTables.length} field
                tables, fetched by the second sweep.
              </p>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => nodeSweep.mutate()}
              disabled={busy || !configured}
              data-testid="button-sweep-nodes"
            >
              {nodeSweep.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Database className="mr-2 h-4 w-4" />
              )}
              1. Fetch sheet list
            </Button>
            <Button
              variant="secondary"
              onClick={() => fieldSweep.mutate()}
              disabled={busy || !configured || (staged?.count ?? 0) === 0}
              data-testid="button-sweep-fields"
            >
              {fieldSweep.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Layers className="mr-2 h-4 w-4" />
              )}
              2. Fetch sheet fields
            </Button>
            <Button
              variant="outline"
              onClick={() => clearStaged.mutate()}
              disabled={busy || (staged?.count ?? 0) === 0}
              data-testid="button-clear-staged"
            >
              {clearStaged.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="mr-2 h-4 w-4" />
              )}
              Clear staging
            </Button>
          </div>

          {busy && (
            <p className="text-xs text-muted-foreground" data-testid="text-sweep-running">
              The legacy system has no way to filter or count, so every row of each table
              is read a page at a time. This can take a minute.
            </p>
          )}

          {nodeReport && (
            <div className="space-y-2 rounded-md border p-3" data-testid="card-node-report">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                {nodeReport.complete ? (
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                ) : (
                  <XCircle className="h-4 w-4 text-red-600" />
                )}
                <span className="font-medium">Sheet list</span>
                <Badge variant={nodeReport.complete ? "default" : "destructive"}>
                  {nodeReport.complete ? "Complete" : "Did not finish"}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {nodeReport.nodesRead} legacy nodes read · {nodeReport.sheetsFound} sheets ·{" "}
                  {nodeReport.sheetsStaged} staged
                  {nodeReport.sheetsRemoved > 0
                    ? ` · ${nodeReport.sheetsRemoved} no longer a sheet, removed`
                    : ""}{" "}
                  · {Math.round(nodeReport.durationMs / 100) / 10}s
                </span>
              </div>
              {nodeReport.error && (
                <Alert variant="destructive" data-testid="alert-node-report-error">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    {nodeReport.error} Nothing was staged, so what is below is from the
                    last sweep that finished.
                  </AlertDescription>
                </Alert>
              )}
              <ReadList reads={nodeReport.reads} />
            </div>
          )}

          {fieldReport && (
            <div className="space-y-2 rounded-md border p-3" data-testid="card-field-report">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                {fieldReport.complete ? (
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                ) : (
                  <XCircle className="h-4 w-4 text-red-600" />
                )}
                <span className="font-medium">Sheet fields</span>
                <Badge variant={fieldReport.complete ? "default" : "destructive"}>
                  {fieldReport.complete ? "Complete" : "Did not finish"}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {fieldReport.sheetsUpdated} of {fieldReport.stagedSheets} staged sheets
                  updated · {Math.round(fieldReport.durationMs / 100) / 10}s
                </span>
              </div>
              {fieldReport.error && (
                <Alert variant="destructive" data-testid="alert-field-report-error">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    {fieldReport.error} No field rows were written: a field table that could
                    not be read looks exactly like a field nobody filled in once it is
                    stored, so the whole sweep is abandoned rather than stage a half-truth.
                  </AlertDescription>
                </Alert>
              )}
              {fieldReport.perTable.length > 0 && (
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Field tables</Label>
                  <div className="rounded-md border divide-y">
                    {fieldReport.perTable.map((t) => (
                      <div
                        key={t.table}
                        className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs"
                        data-testid={`row-field-${t.table}`}
                      >
                        <span>
                          {t.label} <span className="font-mono text-muted-foreground">{t.table}</span>
                        </span>
                        <span className="flex items-center gap-2 text-muted-foreground">
                          <span>{t.rowsRead} rows</span>
                          <span>{t.rowsKept} for staged sheets</span>
                          {!t.complete && <Badge variant="destructive">incomplete</Badge>}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Database className="h-4 w-4" />
            Staged sheets
            <Badge variant="outline" data-testid="badge-staged-count">
              {staged?.count ?? 0}
            </Badge>
          </CardTitle>
          <CardDescription>
            What was copied across, as the legacy system returned it.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {stagedQuery.isLoading && (
            <p className="text-sm text-muted-foreground" data-testid="text-staged-loading">
              Loading staged rows…
            </p>
          )}
          {stagedQuery.isError && (
            <Alert variant="destructive" data-testid="alert-staged-error">
              <AlertDescription>
                {getApiErrorMessage(stagedQuery.error, "Could not read the staged rows.")}
              </AlertDescription>
            </Alert>
          )}
          {staged && staged.count === 0 && (
            <p className="text-sm text-muted-foreground" data-testid="text-staged-empty">
              Nothing is staged yet.
            </p>
          )}
          {staged && staged.count > 0 && (
            <div className="rounded-md border divide-y">
              {staged.rows.map((row) => {
                const fieldTables = row.data?.fields ? Object.keys(row.data.fields) : [];
                const fieldRows = row.data?.fields
                  ? Object.values(row.data.fields).reduce((n, rows) => n + rows.length, 0)
                  : 0;
                const title = (row.data?.node?.title as string | undefined) ?? "(no title)";
                const isOpen = expanded === row.id;
                return (
                  <div key={row.id} className="px-3 py-2 text-xs" data-testid={`row-staged-${row.nid}`}>
                    <button
                      type="button"
                      className="flex w-full flex-wrap items-center justify-between gap-2 text-left"
                      onClick={() => setExpanded(isOpen ? null : row.id)}
                      data-testid={`button-staged-toggle-${row.nid}`}
                    >
                      <span className="flex items-center gap-2">
                        <span className="font-mono">{row.nid}</span>
                        <span>{title}</span>
                      </span>
                      <span className="flex items-center gap-2 text-muted-foreground">
                        <span>
                          {fieldTables.length} field table{fieldTables.length === 1 ? "" : "s"}
                        </span>
                        <span>{fieldRows} field rows</span>
                        {!row.data?.fieldsFetchedAt && (
                          <Badge variant="outline">fields not fetched</Badge>
                        )}
                      </span>
                    </button>
                    {isOpen && (
                      <pre
                        className="mt-2 max-h-96 overflow-auto rounded-md bg-muted p-2"
                        data-testid={`text-staged-data-${row.nid}`}
                      >
                        {JSON.stringify(row.data, null, 2)}
                      </pre>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
