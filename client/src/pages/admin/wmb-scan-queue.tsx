import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Progress } from "@/components/ui/progress";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
import { StaffAlertConfigEditor } from "@/components/staff-alert-config";
import type { StaffAlertConfig } from "@shared/staffAlerts";
import { 
  Clock, 
  Play, 
  RefreshCw, 
  Calendar,
  AlertCircle,
  CheckCircle2,
  Loader2,
  ListOrdered,
  Square,
  Eye,
  XCircle,
  RotateCcw,
  Bell,
  ChevronDown,
  ChevronRight,
  Save
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
  benefitsStarted: number;
  benefitsContinued: number;
  benefitsTerminated: number;
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
  canceled: number;
}

function StatusBadge({ status }: { status: string }) {
  const config = {
    queued: { variant: "secondary" as const, label: "Queued" },
    running: { variant: "default" as const, label: "Running" },
    completed: { variant: "outline" as const, label: "Completed" },
    failed: { variant: "destructive" as const, label: "Failed" },
    stale: { variant: "secondary" as const, label: "Stale" },
    canceled: { variant: "outline" as const, label: "Canceled" },
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
  const [batchSize, setBatchSize] = useState("10");
  const [isRunning, setIsRunning] = useState(false);
  const isRunningRef = useRef(false);
  const processingRef = useRef(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [alertConfig, setAlertConfig] = useState<StaffAlertConfig>({ recipients: [] });
  const [alertConfigDirty, setAlertConfigDirty] = useState(false);

  const { data: statuses = [], isLoading: isLoadingStatuses, refetch: refetchStatuses } = useQuery<MonthStatus[]>({
    queryKey: ["/api/wmb-scan/status"],
  });

  const { data: summary = [], isLoading: isLoadingSummary, refetch: refetchSummary } = useQuery<PendingSummary[]>({
    queryKey: ["/api/wmb-scan/summary"],
  });

  const { data: savedAlertConfig, isLoading: isLoadingAlertConfig } = useQuery<StaffAlertConfig>({
    queryKey: ["/api/staff-alerts/trust_wmb_scan"],
  });

  useEffect(() => {
    if (savedAlertConfig && !alertConfigDirty) {
      setAlertConfig(savedAlertConfig);
    }
  }, [savedAlertConfig, alertConfigDirty]);

  const saveAlertConfigMutation = useMutation({
    mutationFn: async (config: StaffAlertConfig) => {
      return apiRequest("PUT", "/api/staff-alerts/trust_wmb_scan", config);
    },
    onSuccess: () => {
      toast({
        title: "Configuration Saved",
        description: "Alert recipients have been updated",
      });
      setAlertConfigDirty(false);
      queryClient.invalidateQueries({ queryKey: ["/api/staff-alerts/trust_wmb_scan"] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to save configuration",
        variant: "destructive",
      });
    },
  });

  const handleAlertConfigChange = (config: StaffAlertConfig) => {
    setAlertConfig(config);
    setAlertConfigDirty(true);
  };

  const handleSaveAlertConfig = () => {
    saveAlertConfigMutation.mutate(alertConfig);
  };

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

  const cancelScanMutation = useMutation({
    mutationFn: async (statusId: string) => {
      return apiRequest("POST", `/api/wmb-scan/cancel/${statusId}`);
    },
    onSuccess: (result: any) => {
      toast({
        title: "Scan Canceled",
        description: result.message || "Pending scans have been canceled",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/wmb-scan/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/wmb-scan/summary"] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to cancel scan",
        variant: "destructive",
      });
    },
  });

  const resumeScanMutation = useMutation({
    mutationFn: async (statusId: string) => {
      return apiRequest("POST", `/api/wmb-scan/resume/${statusId}`);
    },
    onSuccess: (result: any) => {
      toast({
        title: "Scan Resumed",
        description: result.message || "Canceled scans have been resumed",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/wmb-scan/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/wmb-scan/summary"] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to resume scan",
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
    processBatchMutation.mutate(parseInt(batchSize));
  };

  const handleRefresh = () => {
    refetchStatuses();
    refetchSummary();
  };

  const handleStartContinuous = () => {
    isRunningRef.current = true;
    setIsRunning(true);
  };

  const handleStopContinuous = () => {
    isRunningRef.current = false;
    setIsRunning(false);
  };

  // Continuous processing effect
  useEffect(() => {
    if (!isRunning) return;

    const runBatch = async () => {
      if (!isRunningRef.current || processingRef.current) return;
      
      // Check if there are pending items
      const currentPending = summary.reduce((acc, s) => acc + s.pending + s.processing, 0);
      if (currentPending === 0) {
        handleStopContinuous();
        toast({
          title: "Processing Complete",
          description: "All pending scans have been processed.",
        });
        return;
      }

      processingRef.current = true;
      try {
        await apiRequest("POST", "/api/wmb-scan/process-batch", { batchSize: parseInt(batchSize) });
        await Promise.all([refetchStatuses(), refetchSummary()]);
      } catch (error: any) {
        toast({
          title: "Error",
          description: error.message || "Failed to process batch",
          variant: "destructive",
        });
        handleStopContinuous();
      } finally {
        processingRef.current = false;
      }
    };

    const intervalId = setInterval(runBatch, 2000);
    runBatch(); // Run immediately on start

    return () => {
      clearInterval(intervalId);
    };
  }, [isRunning, batchSize, summary, refetchStatuses, refetchSummary, toast]);

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
              {isRunning ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Play className="h-5 w-5" />
              )}
              Process Queue
              {isRunning && (
                <Badge variant="default" className="ml-2">Running</Badge>
              )}
            </CardTitle>
            <CardDescription>
              Process pending scans from the queue ({totalPending} pending)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex flex-wrap items-end gap-4">
                <div className="space-y-2">
                  <Label htmlFor="batch-size-select">Batch Size</Label>
                  <Select value={batchSize} onValueChange={setBatchSize} disabled={isRunning}>
                    <SelectTrigger id="batch-size-select" className="w-24" data-testid="select-batch-size">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="5">5</SelectItem>
                      <SelectItem value="10">10</SelectItem>
                      <SelectItem value="25">25</SelectItem>
                      <SelectItem value="50">50</SelectItem>
                      <SelectItem value="100">100</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button 
                  onClick={handleProcessBatch}
                  disabled={processBatchMutation.isPending || totalPending === 0 || isRunning}
                  data-testid="button-process-batch"
                >
                  {processBatchMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4 mr-2" />
                  )}
                  Process Batch
                </Button>
                {isRunning ? (
                  <Button 
                    onClick={handleStopContinuous}
                    variant="destructive"
                    data-testid="button-stop-continuous"
                  >
                    <Square className="h-4 w-4 mr-2" />
                    Stop
                  </Button>
                ) : (
                  <Button 
                    onClick={handleStartContinuous}
                    variant="outline"
                    disabled={totalPending === 0}
                    data-testid="button-start-continuous"
                  >
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Run Continuously
                  </Button>
                )}
              </div>
              {totalPending > 0 && (
                <p className="text-sm text-muted-foreground">
                  {isRunning 
                    ? `Processing... ${totalPending} worker scans remaining.`
                    : `${totalPending} worker scans are pending across all months.`
                  }
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Collapsible open={alertsOpen} onOpenChange={setAlertsOpen} className="mb-6">
        <Card>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer hover-elevate rounded-t-lg">
              <CardTitle className="flex items-center gap-2">
                {alertsOpen ? (
                  <ChevronDown className="h-5 w-5" />
                ) : (
                  <ChevronRight className="h-5 w-5" />
                )}
                <Bell className="h-5 w-5" />
                Scan Completion Alerts
                {alertConfig.recipients.length > 0 && (
                  <Badge variant="secondary" className="ml-2">
                    {alertConfig.recipients.length} recipient{alertConfig.recipients.length !== 1 ? "s" : ""}
                  </Badge>
                )}
              </CardTitle>
              <CardDescription>
                Configure who receives notifications when monthly scans complete
              </CardDescription>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="pt-0">
              {isLoadingAlertConfig ? (
                <div className="space-y-3">
                  {[1, 2, 3].map(i => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : (
                <div className="space-y-4">
                  <StaffAlertConfigEditor
                    value={alertConfig}
                    onChange={handleAlertConfigChange}
                    disabled={saveAlertConfigMutation.isPending}
                  />
                  <div className="flex items-center gap-2 pt-2">
                    <Button
                      onClick={handleSaveAlertConfig}
                      disabled={!alertConfigDirty || saveAlertConfigMutation.isPending}
                      data-testid="button-save-alert-config"
                    >
                      {saveAlertConfigMutation.isPending ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Save className="h-4 w-4 mr-2" />
                      )}
                      Save Configuration
                    </Button>
                    {alertConfigDirty && (
                      <span className="text-sm text-muted-foreground">Unsaved changes</span>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      <Card>
        <CardHeader>
          <CardTitle>Scan Status by Month</CardTitle>
          <CardDescription>
            Status and progress of monthly worker benefit scans
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
                  <TableHead>Progress</TableHead>
                  <TableHead className="text-right text-green-600 dark:text-green-400">Started</TableHead>
                  <TableHead className="text-right text-blue-600 dark:text-blue-400">Continued</TableHead>
                  <TableHead className="text-right text-red-600 dark:text-red-400">Terminated</TableHead>
                  <TableHead>Queued At</TableHead>
                  <TableHead>Completed At</TableHead>
                  <TableHead className="w-24"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {statuses.map((status) => {
                  // Find matching summary for this status
                  const matchingSummary = summary.find(s => s.month === status.month && s.year === status.year);
                  const pending = matchingSummary?.pending ?? 0;
                  const processing = matchingSummary?.processing ?? 0;
                  const success = status.processedSuccess;
                  const failed = status.processedFailed;
                  const total = status.totalQueued;
                  const processed = success + failed;
                  const progress = total > 0 ? (processed / total) * 100 : 0;
                  
                  return (
                    <TableRow key={status.id}>
                      <TableCell className="font-medium" data-testid={`text-status-month-${status.id}`}>
                        {MonthName(status.month)} {status.year}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={status.status} />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Progress value={progress} className="h-2 w-20" />
                          <span className="text-xs text-muted-foreground whitespace-nowrap">
                            {processed}/{total}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right text-green-600 dark:text-green-400" data-testid={`text-benefits-started-${status.id}`}>{status.benefitsStarted}</TableCell>
                      <TableCell className="text-right text-blue-600 dark:text-blue-400" data-testid={`text-benefits-continued-${status.id}`}>{status.benefitsContinued}</TableCell>
                      <TableCell className="text-right text-red-600 dark:text-red-400" data-testid={`text-benefits-terminated-${status.id}`}>{status.benefitsTerminated}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {status.queuedAt ? format(new Date(status.queuedAt), "MMM d, HH:mm") : "-"}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {status.completedAt ? format(new Date(status.completedAt), "MMM d, HH:mm") : "-"}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Link href={`/admin/wmb-scan/${status.id}`}>
                                <Button variant="ghost" size="icon" data-testid={`button-view-${status.id}`}>
                                  <Eye className="h-4 w-4" />
                                </Button>
                              </Link>
                            </TooltipTrigger>
                            <TooltipContent>View details</TooltipContent>
                          </Tooltip>
                          {(status.status === "queued" || status.status === "running" || status.status === "stale") && pending > 0 && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button 
                                  variant="ghost" 
                                  size="icon" 
                                  onClick={() => cancelScanMutation.mutate(status.id)}
                                  disabled={cancelScanMutation.isPending}
                                  data-testid={`button-cancel-${status.id}`}
                                >
                                  <XCircle className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Cancel pending scans</TooltipContent>
                            </Tooltip>
                          )}
                          {status.status === "canceled" && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button 
                                  variant="ghost" 
                                  size="icon" 
                                  onClick={() => resumeScanMutation.mutate(status.id)}
                                  disabled={resumeScanMutation.isPending}
                                  data-testid={`button-resume-${status.id}`}
                                >
                                  <RotateCcw className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Resume canceled scans</TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
