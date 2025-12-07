import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { 
  Clock, 
  Play, 
  RefreshCw, 
  Calendar,
  AlertCircle,
  CheckCircle2,
  Loader2,
  ListOrdered
} from "lucide-react";
import { format } from "date-fns";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface MonthStatus {
  id: string;
  month: number;
  year: number;
  status: string;
  totalQueued: number;
  processedSuccess: number;
  processedFailed: number;
  queuedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  lastError: string | null;
}

interface PendingSummary {
  month: number;
  year: number;
  pending: number;
  processing: number;
  success: number;
  failed: number;
}

function StatusBadge({ status }: { status: string }) {
  const config = {
    queued: { variant: "secondary" as const, label: "Queued" },
    running: { variant: "default" as const, label: "Running" },
    completed: { variant: "outline" as const, label: "Completed" },
    failed: { variant: "destructive" as const, label: "Failed" },
    stale: { variant: "secondary" as const, label: "Stale" },
  };
  
  const c = config[status as keyof typeof config] || { variant: "outline" as const, label: status };
  return <Badge variant={c.variant} data-testid={`badge-status-${status}`}>{c.label}</Badge>;
}

function MonthName(month: number): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return months[month - 1] || String(month);
}

export default function WmbScanQueue() {
  const { toast } = useToast();
  const currentDate = new Date();
  const [selectedMonth, setSelectedMonth] = useState(String(currentDate.getMonth() + 1));
  const [selectedYear, setSelectedYear] = useState(String(currentDate.getFullYear()));

  const { data: statuses = [], isLoading: isLoadingStatuses, refetch: refetchStatuses } = useQuery<MonthStatus[]>({
    queryKey: ["/api/wmb-scan/status"],
  });

  const { data: summary = [], isLoading: isLoadingSummary, refetch: refetchSummary } = useQuery<PendingSummary[]>({
    queryKey: ["/api/wmb-scan/summary"],
  });

  const enqueueMonthMutation = useMutation({
    mutationFn: async ({ month, year }: { month: number; year: number }) => {
      return apiRequest("POST", "/api/wmb-scan/enqueue-month", { month, year });
    },
    onSuccess: (result: any) => {
      toast({
        title: "Month Enqueued",
        description: result.message || "Workers queued successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/wmb-scan/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/wmb-scan/summary"] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to enqueue month",
        variant: "destructive",
      });
    },
  });

  const processBatchMutation = useMutation({
    mutationFn: async (batchSize: number) => {
      return apiRequest("POST", "/api/wmb-scan/process-batch", { batchSize });
    },
    onSuccess: (result: any) => {
      toast({
        title: "Batch Processed",
        description: result.message || "Batch processed successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/wmb-scan/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/wmb-scan/summary"] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to process batch",
        variant: "destructive",
      });
    },
  });

  const years = Array.from({ length: 5 }, (_, i) => currentDate.getFullYear() + i - 2);
  const months = Array.from({ length: 12 }, (_, i) => i + 1);

  const handleEnqueueMonth = () => {
    enqueueMonthMutation.mutate({
      month: parseInt(selectedMonth),
      year: parseInt(selectedYear),
    });
  };

  const handleProcessBatch = () => {
    processBatchMutation.mutate(10);
  };

  const handleRefresh = () => {
    refetchStatuses();
    refetchSummary();
  };

  if (isLoadingStatuses || isLoadingSummary) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Skeleton className="h-10 w-64 mb-8" />
        <div className="grid gap-6 md:grid-cols-2">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
        <Skeleton className="h-96 mt-6" />
      </div>
    );
  }

  const totalPending = summary.reduce((acc, s) => acc + s.pending + s.processing, 0);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground" data-testid="text-page-title">WMB Scan Queue</h1>
          <p className="text-muted-foreground mt-2">
            Manage monthly worker benefit scans and monitor processing status.
          </p>
        </div>
        <Button 
          variant="outline" 
          onClick={handleRefresh}
          data-testid="button-refresh"
        >
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      <div className="grid gap-6 md:grid-cols-2 mb-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Queue Month for Scanning
            </CardTitle>
            <CardDescription>
              Queue all active workers to be scanned for a specific month
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-end gap-4">
              <div className="space-y-2">
                <Label htmlFor="month-select">Month</Label>
                <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                  <SelectTrigger id="month-select" className="w-32" data-testid="select-month">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {months.map(m => (
                      <SelectItem key={m} value={String(m)}>{MonthName(m)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="year-select">Year</Label>
                <Select value={selectedYear} onValueChange={setSelectedYear}>
                  <SelectTrigger id="year-select" className="w-24" data-testid="select-year">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {years.map(y => (
                      <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button 
                onClick={handleEnqueueMonth}
                disabled={enqueueMonthMutation.isPending}
                data-testid="button-enqueue-month"
              >
                {enqueueMonthMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <ListOrdered className="h-4 w-4 mr-2" />
                )}
                Queue Month
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Play className="h-5 w-5" />
              Process Queue
            </CardTitle>
            <CardDescription>
              Process pending scans from the queue ({totalPending} pending)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <Button 
                  onClick={handleProcessBatch}
                  disabled={processBatchMutation.isPending || totalPending === 0}
                  data-testid="button-process-batch"
                >
                  {processBatchMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4 mr-2" />
                  )}
                  Process Batch (10)
                </Button>
              </div>
              {totalPending > 0 && (
                <p className="text-sm text-muted-foreground">
                  {totalPending} worker scans are pending across all months.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {summary.length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Queue Summary by Month</CardTitle>
            <CardDescription>
              Overview of pending scans grouped by month
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Month</TableHead>
                  <TableHead className="text-right">Pending</TableHead>
                  <TableHead className="text-right">Processing</TableHead>
                  <TableHead className="text-right">Success</TableHead>
                  <TableHead className="text-right">Failed</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Progress</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.map((s) => {
                  const total = s.pending + s.processing + s.success + s.failed;
                  const progress = total > 0 ? ((s.success + s.failed) / total) * 100 : 0;
                  return (
                    <TableRow key={`${s.year}-${s.month}`}>
                      <TableCell className="font-medium" data-testid={`text-month-${s.year}-${s.month}`}>
                        {MonthName(s.month)} {s.year}
                      </TableCell>
                      <TableCell className="text-right">{s.pending}</TableCell>
                      <TableCell className="text-right">{s.processing}</TableCell>
                      <TableCell className="text-right text-green-600">{s.success}</TableCell>
                      <TableCell className="text-right text-red-600">{s.failed}</TableCell>
                      <TableCell className="text-right font-medium">{total}</TableCell>
                      <TableCell className="w-32">
                        <Progress value={progress} className="h-2" />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Month Statuses</CardTitle>
          <CardDescription>
            Detailed status of each month's scan process
          </CardDescription>
        </CardHeader>
        <CardContent>
          {statuses.length === 0 ? (
            <div className="text-center py-12">
              <Clock className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No Months Queued</h3>
              <p className="text-sm text-muted-foreground">
                Queue a month to start scanning workers.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Month</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Queued</TableHead>
                  <TableHead className="text-right">Success</TableHead>
                  <TableHead className="text-right">Failed</TableHead>
                  <TableHead>Queued At</TableHead>
                  <TableHead>Completed At</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {statuses.map((status) => (
                  <TableRow key={status.id}>
                    <TableCell className="font-medium" data-testid={`text-status-month-${status.id}`}>
                      {MonthName(status.month)} {status.year}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={status.status} />
                    </TableCell>
                    <TableCell className="text-right">{status.totalQueued}</TableCell>
                    <TableCell className="text-right text-green-600">{status.processedSuccess}</TableCell>
                    <TableCell className="text-right text-red-600">{status.processedFailed}</TableCell>
                    <TableCell>
                      {status.queuedAt ? format(new Date(status.queuedAt), "MMM d, yyyy HH:mm") : "-"}
                    </TableCell>
                    <TableCell>
                      {status.completedAt ? format(new Date(status.completedAt), "MMM d, yyyy HH:mm") : "-"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
