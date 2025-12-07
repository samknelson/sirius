import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { useState, useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { 
  ArrowLeft, 
  Download, 
  Calendar,
  AlertCircle,
  User,
  TrendingUp,
  TrendingDown,
  Minus,
  Eye,
  ShieldCheck,
  ShieldX,
  Search,
  ChevronLeft,
  ChevronRight,
  ExternalLink
} from "lucide-react";
import { format } from "date-fns";

interface MonthStatus {
  id: string;
  month: number;
  year: number;
  status: string;
  totalQueued: number;
  processedSuccess: number;
  processedFailed: number;
  benefitsStarted: number;
  benefitsContinued: number;
  benefitsTerminated: number;
  queuedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  lastError: string | null;
}

interface QueueEntry {
  id: string;
  workerId: string;
  status: string;
  triggerSource: string;
  attempts: number;
  completedAt: string | null;
  lastError: string | null;
  resultSummary: any;
  workerSiriusId: number | null;
  workerDisplayName: string | null;
}

interface ScanStatusResponse {
  status: MonthStatus;
}

interface PagedEntriesResponse {
  data: QueueEntry[];
  page: number;
  pageSize: number;
  total: number;
}

interface PluginResult {
  pluginKey: string;
  eligible: boolean;
  reason?: string;
}

interface BenefitAction {
  benefitId: string;
  benefitName: string;
  scanType: "start" | "continue";
  eligible: boolean;
  action: "create" | "delete" | "none";
  executed: boolean;
  pluginResults?: PluginResult[];
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { variant: "default" | "secondary" | "outline" | "destructive"; label: string }> = {
    queued: { variant: "secondary", label: "Queued" },
    running: { variant: "default", label: "Running" },
    completed: { variant: "outline", label: "Completed" },
    failed: { variant: "destructive", label: "Failed" },
    stale: { variant: "secondary", label: "Stale" },
    pending: { variant: "secondary", label: "Pending" },
    processing: { variant: "default", label: "Processing" },
    success: { variant: "outline", label: "Success" },
    invalidated: { variant: "secondary", label: "Invalidated" },
    skipped: { variant: "secondary", label: "Skipped" },
    canceled: { variant: "secondary", label: "Canceled" },
  };
  
  const c = config[status] || { variant: "outline", label: status };
  return <Badge variant={c.variant} data-testid={`badge-status-${status}`}>{c.label}</Badge>;
}

function MonthName(month: number): string {
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return months[month - 1] || String(month);
}

function getResultCounts(resultSummary: any) {
  let started = 0, continued = 0, terminated = 0;
  
  if (resultSummary?.actions && Array.isArray(resultSummary.actions)) {
    for (const action of resultSummary.actions) {
      if (action.scanType === "start" && action.eligible) started++;
      else if (action.scanType === "continue") {
        if (action.action === "delete") terminated++;
        else if (action.eligible) continued++;
      }
    }
  }
  
  return { started, continued, terminated };
}

function BenefitDetailsModal({ 
  entry, 
  open, 
  onClose 
}: { 
  entry: QueueEntry | null; 
  open: boolean; 
  onClose: () => void;
}) {
  if (!entry) return null;

  const actions = (entry.resultSummary?.actions || []) as BenefitAction[];
  const started = actions.filter(a => a.scanType === "start" && a.eligible);
  const continued = actions.filter(a => a.scanType === "continue" && a.eligible && a.action !== "delete");
  const terminated = actions.filter(a => a.scanType === "continue" && a.action === "delete");

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            {entry.workerDisplayName || "Unknown Worker"}
          </DialogTitle>
          <DialogDescription>
            Sirius ID: {entry.workerSiriusId || "-"} | Policy: {entry.resultSummary?.policyName || "Unknown"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {started.length > 0 && (
            <div>
              <h4 className="font-medium flex items-center gap-2 mb-2 text-green-600 dark:text-green-400">
                <TrendingUp className="h-4 w-4" />
                Benefits Started ({started.length})
              </h4>
              <div className="space-y-2">
                {started.map((action, i) => (
                  <div key={i} className="p-3 bg-green-50 dark:bg-green-950/20 rounded-md border border-green-200 dark:border-green-900">
                    <div className="font-medium">{action.benefitName}</div>
                    {action.pluginResults && action.pluginResults.length > 0 && (
                      <div className="mt-2 text-sm space-y-1">
                        {action.pluginResults.map((pr, j) => (
                          <div key={j} className="flex items-center gap-2">
                            {pr.eligible ? (
                              <ShieldCheck className="h-3 w-3 text-green-600" />
                            ) : (
                              <ShieldX className="h-3 w-3 text-red-600" />
                            )}
                            <span className="font-mono text-xs">{pr.pluginKey}</span>
                            {pr.reason && <span className="text-muted-foreground">- {pr.reason}</span>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {continued.length > 0 && (
            <div>
              <h4 className="font-medium flex items-center gap-2 mb-2">
                <Minus className="h-4 w-4" />
                Benefits Continued ({continued.length})
              </h4>
              <div className="space-y-2">
                {continued.map((action, i) => (
                  <div key={i} className="p-3 bg-muted/50 rounded-md border">
                    <div className="font-medium">{action.benefitName}</div>
                    {action.pluginResults && action.pluginResults.length > 0 && (
                      <div className="mt-2 text-sm space-y-1">
                        {action.pluginResults.map((pr, j) => (
                          <div key={j} className="flex items-center gap-2">
                            {pr.eligible ? (
                              <ShieldCheck className="h-3 w-3 text-green-600" />
                            ) : (
                              <ShieldX className="h-3 w-3 text-red-600" />
                            )}
                            <span className="font-mono text-xs">{pr.pluginKey}</span>
                            {pr.reason && <span className="text-muted-foreground">- {pr.reason}</span>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {terminated.length > 0 && (
            <div>
              <h4 className="font-medium flex items-center gap-2 mb-2 text-red-600 dark:text-red-400">
                <TrendingDown className="h-4 w-4" />
                Benefits Terminated ({terminated.length})
              </h4>
              <div className="space-y-2">
                {terminated.map((action, i) => {
                  const failedPlugins = action.pluginResults?.filter(pr => !pr.eligible) || [];
                  return (
                    <div key={i} className="p-3 bg-red-50 dark:bg-red-950/20 rounded-md border border-red-200 dark:border-red-900">
                      <div className="font-medium">{action.benefitName}</div>
                      {failedPlugins.length > 0 && (
                        <div className="mt-2 text-sm space-y-1">
                          <div className="text-muted-foreground text-xs mb-1">Failed eligibility checks:</div>
                          {failedPlugins.map((pr, j) => (
                            <div key={j} className="flex items-center gap-2">
                              <ShieldX className="h-3 w-3 text-red-600" />
                              <span className="font-mono text-xs">{pr.pluginKey}</span>
                              {pr.reason && <span className="text-muted-foreground">- {pr.reason}</span>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {started.length === 0 && continued.length === 0 && terminated.length === 0 && (
            <div className="text-center text-muted-foreground py-4">
              No benefit changes recorded for this worker
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function WmbScanDetail() {
  const { id } = useParams<{ id: string }>();
  const [selectedEntry, setSelectedEntry] = useState<QueueEntry | null>(null);
  
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [outcome, setOutcome] = useState<string>("all");

  const { data: statusData, isLoading: statusLoading, error: statusError } = useQuery<ScanStatusResponse>({
    queryKey: ["/api/wmb-scan/detail", id],
    enabled: !!id,
  });

  const queryParams = useMemo(() => {
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("pageSize", String(pageSize));
    if (debouncedSearch) params.set("search", debouncedSearch);
    if (outcome && outcome !== "all") params.set("outcome", outcome);
    return params.toString();
  }, [page, pageSize, debouncedSearch, outcome]);

  const { data: entriesData, isLoading: entriesLoading } = useQuery<PagedEntriesResponse>({
    queryKey: ["/api/wmb-scan/detail", id, "entries", queryParams],
    queryFn: async () => {
      const res = await fetch(`/api/wmb-scan/detail/${id}/entries?${queryParams}`);
      if (!res.ok) throw new Error("Failed to fetch entries");
      return res.json();
    },
    enabled: !!id,
  });

  const handleSearchChange = (value: string) => {
    setSearch(value);
    setTimeout(() => {
      setDebouncedSearch(value);
      setPage(1);
    }, 300);
  };

  const handleOutcomeChange = (value: string) => {
    setOutcome(value);
    setPage(1);
  };

  const handleExport = () => {
    const exportParams = new URLSearchParams();
    if (debouncedSearch) exportParams.set("search", debouncedSearch);
    if (outcome && outcome !== "all") exportParams.set("outcome", outcome);
    const queryString = exportParams.toString();
    window.location.href = `/api/wmb-scan/detail/${id}/export${queryString ? `?${queryString}` : ""}`;
  };

  if (statusLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (statusError || !statusData) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-5 w-5" />
              <span>Failed to load scan details</span>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { status } = statusData;
  const totalProcessed = status.processedSuccess + status.processedFailed;
  const progressPercent = status.totalQueued > 0 ? (totalProcessed / status.totalQueued) * 100 : 0;

  const totalPages = entriesData ? Math.ceil(entriesData.total / pageSize) : 0;
  const entries = entriesData?.data || [];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          <Link href="/admin/wmb-scan-queue">
            <Button variant="ghost" size="icon" data-testid="button-back">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-semibold" data-testid="text-scan-title">
              Benefits Scan: {MonthName(status.month)} {status.year}
            </h1>
            <p className="text-muted-foreground flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              Queued {format(new Date(status.queuedAt), "MMM d, yyyy 'at' h:mm a")}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={status.status} />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Progress</CardDescription>
            <CardTitle className="text-2xl" data-testid="text-progress">
              {totalProcessed} / {status.totalQueued}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Progress value={progressPercent} className="h-2" />
            <p className="text-xs text-muted-foreground mt-2">
              {status.processedSuccess} succeeded, {status.processedFailed} failed
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1">
              <TrendingUp className="h-3 w-3" />
              Benefits Started
            </CardDescription>
            <CardTitle className="text-2xl text-green-600 dark:text-green-400" data-testid="text-started">
              {status.benefitsStarted}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              Workers newly eligible
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1">
              <Minus className="h-3 w-3" />
              Benefits Continued
            </CardDescription>
            <CardTitle className="text-2xl" data-testid="text-continued">
              {status.benefitsContinued}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              Workers still eligible
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1">
              <TrendingDown className="h-3 w-3" />
              Benefits Terminated
            </CardDescription>
            <CardTitle className="text-2xl text-red-600 dark:text-red-400" data-testid="text-terminated">
              {status.benefitsTerminated}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              Workers no longer eligible
            </p>
          </CardContent>
        </Card>
      </div>

      {status.startedAt && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Timing</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Started:</span>{" "}
                <span data-testid="text-started-at">{format(new Date(status.startedAt), "MMM d, yyyy 'at' h:mm a")}</span>
              </div>
              {status.completedAt && (
                <div>
                  <span className="text-muted-foreground">Completed:</span>{" "}
                  <span data-testid="text-completed-at">{format(new Date(status.completedAt), "MMM d, yyyy 'at' h:mm a")}</span>
                </div>
              )}
              {status.completedAt && status.startedAt && (
                <div>
                  <span className="text-muted-foreground">Duration:</span>{" "}
                  <span data-testid="text-duration">
                    {Math.round((new Date(status.completedAt).getTime() - new Date(status.startedAt).getTime()) / 1000)}s
                  </span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {status.lastError && (
        <Card className="border-destructive">
          <CardHeader>
            <CardTitle className="text-lg text-destructive flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              Last Error
            </CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="text-sm text-muted-foreground whitespace-pre-wrap" data-testid="text-last-error">
              {status.lastError}
            </pre>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle>Worker Results</CardTitle>
              <CardDescription>
                {entriesData ? `${entriesData.total} workers total` : "Loading..."}
                {debouncedSearch || outcome !== "all" ? " (filtered)" : ""}
              </CardDescription>
            </div>
            <Button onClick={handleExport} variant="outline" data-testid="button-export">
              <Download className="h-4 w-4 mr-2" />
              Export CSV
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-4 md:flex-row md:items-center">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name or Sirius ID..."
                value={search}
                onChange={(e) => handleSearchChange(e.target.value)}
                className="pl-9"
                data-testid="input-search"
              />
            </div>
            <Select value={outcome} onValueChange={handleOutcomeChange}>
              <SelectTrigger className="w-[180px]" data-testid="select-outcome">
                <SelectValue placeholder="Filter by outcome" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All outcomes</SelectItem>
                <SelectItem value="started">Started benefits</SelectItem>
                <SelectItem value="continued">Continued benefits</SelectItem>
                <SelectItem value="terminated">Terminated benefits</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">Sirius ID</TableHead>
                  <TableHead>Worker</TableHead>
                  <TableHead className="w-28">Status</TableHead>
                  <TableHead className="w-32">Source</TableHead>
                  <TableHead className="w-20 text-center">Started</TableHead>
                  <TableHead className="w-20 text-center">Continued</TableHead>
                  <TableHead className="w-20 text-center">Terminated</TableHead>
                  <TableHead className="w-48">Completed</TableHead>
                  <TableHead className="w-24"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entriesLoading ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-8">
                      <div className="flex items-center justify-center gap-2 text-muted-foreground">
                        Loading...
                      </div>
                    </TableCell>
                  </TableRow>
                ) : entries.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                      {debouncedSearch || outcome !== "all" 
                        ? "No workers match the current filters"
                        : "No workers in this scan"
                      }
                    </TableCell>
                  </TableRow>
                ) : (
                  entries.map((entry) => {
                    const counts = getResultCounts(entry.resultSummary);
                    return (
                      <TableRow key={entry.id} data-testid={`row-worker-${entry.workerSiriusId}`}>
                        <TableCell className="font-mono" data-testid={`text-sirius-id-${entry.id}`}>
                          {entry.workerSiriusId || "-"}
                        </TableCell>
                        <TableCell data-testid={`text-worker-name-${entry.id}`}>
                          <div className="flex items-center gap-2">
                            <User className="h-4 w-4 text-muted-foreground" />
                            {entry.workerDisplayName || "Unknown"}
                          </div>
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={entry.status} />
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {entry.triggerSource}
                        </TableCell>
                        <TableCell className="text-center">
                          {counts.started > 0 ? (
                            <span className="text-green-600 dark:text-green-400 font-medium">{counts.started}</span>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          {counts.continued > 0 ? (
                            <span className="font-medium">{counts.continued}</span>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          {counts.terminated > 0 ? (
                            <span className="text-red-600 dark:text-red-400 font-medium">{counts.terminated}</span>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {entry.completedAt ? format(new Date(entry.completedAt), "MMM d, h:mm a") : "-"}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Link href={`/workers/${entry.workerId}`}>
                              <Button 
                                variant="ghost" 
                                size="icon"
                                title="View worker"
                                data-testid={`button-view-worker-${entry.id}`}
                              >
                                <ExternalLink className="h-4 w-4" />
                              </Button>
                            </Link>
                            {entry.status === "success" && entry.resultSummary?.actions && (
                              <Button 
                                variant="ghost" 
                                size="icon"
                                onClick={() => setSelectedEntry(entry)}
                                title="View benefit details"
                                data-testid={`button-view-details-${entry.id}`}
                              >
                                <Eye className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <div className="text-sm text-muted-foreground">
                Page {page} of {totalPages} ({entriesData?.total || 0} results)
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  data-testid="button-prev-page"
                >
                  <ChevronLeft className="h-4 w-4" />
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  data-testid="button-next-page"
                >
                  Next
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <BenefitDetailsModal 
        entry={selectedEntry} 
        open={selectedEntry !== null} 
        onClose={() => setSelectedEntry(null)} 
      />
    </div>
  );
}
