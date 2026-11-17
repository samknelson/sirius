import { useState } from "react";
import type { ProcessPage } from "@shared/processes";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, ChevronLeft, ChevronRight, Info, RefreshCw } from "lucide-react";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { getApiErrorMessage } from "@/lib/queryClient";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

function ProcessTimestamp({ value }: { value: string }) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return <span className="text-muted-foreground">Invalid timestamp</span>;
  }
  const iso = date.toISOString();
  return (
    <time dateTime={iso} title={iso} className="whitespace-nowrap font-mono text-xs">
      {iso.replace("T", " ").replace("Z", " UTC")}
    </time>
  );
}

export default function ProcessesPage() {
  usePageTitle("Processes");
  const [page, setPage] = useState(1);
  const queryParams = new URLSearchParams({ page: String(page), pageSize: "50" });
  const { data, isLoading, isError, error, isFetching, refetch } = useQuery<ProcessPage>({
    queryKey: [`/api/processes?${queryParams.toString()}`],
    staleTime: 0,
    refetchInterval: 60_000,
  });
  const entries = data?.entries ?? [];

  return (
    <div className="container mx-auto py-8">
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1.5">
              <CardTitle data-testid="title-page">Processes</CardTitle>
              <CardDescription>Read-only process registrations and last recorded heartbeats.</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching} data-testid="button-refresh-processes">
              <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
              {isFetching ? "Refreshing…" : "Refresh"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <Alert>
            <Info className="h-4 w-4" aria-hidden="true" />
            <AlertTitle>Observations, not health checks</AlertTitle>
            <AlertDescription>
              <p>Reporting and Stale describe heartbeat recency only. Stale does not mean a process is dead, and neither status establishes readiness or health.</p>
              <p className="mt-2">This is not a complete process inventory: pure-static processes, report-only invocations, and processes that fail before database registration are absent. Times are shown in UTC. Use Refresh to request the latest observations.</p>
            </AlertDescription>
          </Alert>

          {isError ? (
            <Alert variant="destructive" role="alert" data-testid="error-processes">
              <AlertCircle className="h-4 w-4" aria-hidden="true" />
              <AlertTitle>Unable to load processes</AlertTitle>
              <AlertDescription>
                <p>{getApiErrorMessage(error, "Process observations could not be retrieved. Please try again.")}</p>
                <Button className="mt-3" variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching} data-testid="button-retry-processes">
                  {isFetching ? "Retrying…" : "Retry"}
                </Button>
              </AlertDescription>
            </Alert>
          ) : isLoading ? (
            <div role="status" aria-label="Loading processes" data-testid="loading-processes" className="space-y-3">
              <span className="sr-only">Loading processes…</span>
              <Skeleton className="h-5 w-48" />
              {Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-12 w-full" />)}
            </div>
          ) : data ? (
            <>
              <div className="text-sm text-muted-foreground" aria-live="polite" data-testid="text-results-count">
                Showing {entries.length} of {data.total} processes
              </div>
              <div className="rounded-md border" aria-busy={isFetching}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ID</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Roles</TableHead>
                      <TableHead>Start (UTC)</TableHead>
                      <TableHead>Last heartbeat (UTC)</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {entries.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="py-12 text-center" data-testid="empty-processes">
                          <p className="font-medium">{data.total === 0 ? "No process observations recorded" : "No processes on this page"}</p>
                          <p className="mt-2 text-sm text-muted-foreground">
                            {data.total === 0 ? "No registrations were returned. This does not establish that no processes are running." : "Use Previous to return to an earlier page."}
                          </p>
                        </TableCell>
                      </TableRow>
                    ) : entries.map((entry) => (
                      <TableRow key={entry.id} data-testid={`row-process-${entry.id}`}>
                        <TableCell className="break-all font-mono text-xs">{entry.id}</TableCell>
                        <TableCell className="min-w-[120px] break-words">
                          {entry.name ?? <span className="text-muted-foreground">Unnamed</span>}
                        </TableCell>
                        <TableCell>
                          {entry.roles.length ? (
                            <div className="flex min-w-[100px] flex-wrap gap-1">
                              {entry.roles.map((role, index) => <Badge variant="outline" key={`${role}-${index}`}>{role}</Badge>)}
                            </div>
                          ) : <span className="text-muted-foreground">None reported</span>}
                        </TableCell>
                        <TableCell><ProcessTimestamp value={entry.startedTs} /></TableCell>
                        <TableCell><ProcessTimestamp value={entry.updatedTs} /></TableCell>
                        <TableCell>
                          <Badge variant={entry.status === "Stale" ? "outline" : "secondary"} data-testid={`badge-status-${entry.id}`}>
                            {entry.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          ) : null}

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground" data-testid="text-pagination">
              {data && !isError ? `Page ${data.page} of ${Math.max(1, data.totalPages)}` : `Page ${page}`}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setPage(current => Math.max(1, current - 1))} disabled={page <= 1 || isFetching} data-testid="button-previous-page">
                <ChevronLeft className="mr-1 h-4 w-4" aria-hidden="true" />Previous
              </Button>
              <Button variant="outline" size="sm" onClick={() => setPage(current => current + 1)} disabled={!data || isError || isFetching || page >= data.totalPages} data-testid="button-next-page">
                Next<ChevronRight className="ml-1 h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
