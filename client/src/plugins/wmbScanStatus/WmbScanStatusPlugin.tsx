import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Link } from "wouter";
import { 
  Activity, 
  ArrowRight, 
  Calendar, 
  CheckCircle2, 
  Clock, 
  Loader2,
  TrendingUp,
  TrendingDown,
  Minus
} from "lucide-react";
import { DashboardPluginProps } from "../types";

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
}

function MonthName(month: number): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return months[month - 1] || String(month);
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { variant: "default" | "secondary" | "outline" | "destructive"; label: string }> = {
    queued: { variant: "secondary", label: "Queued" },
    running: { variant: "default", label: "Running" },
    completed: { variant: "outline", label: "Completed" },
    failed: { variant: "destructive", label: "Failed" },
    canceled: { variant: "secondary", label: "Canceled" },
  };
  
  const c = config[status] || { variant: "outline", label: status };
  return <Badge variant={c.variant}>{c.label}</Badge>;
}

export function WmbScanStatusPlugin({ userPermissions }: DashboardPluginProps) {
  const hasPermission = userPermissions.includes("admin");

  const { data: statuses = [], isLoading } = useQuery<MonthStatus[]>({
    queryKey: ["/api/wmb-scan/status"],
    enabled: hasPermission,
  });

  if (!hasPermission) {
    return null;
  }

  if (isLoading) {
    return (
      <Card data-testid="plugin-wmb-scan-status">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Benefits Scan Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();

  const runningScans = statuses.filter(s => s.status === "running");
  
  const currentAndFutureScans = statuses.filter(s => {
    if (s.year > currentYear) return true;
    if (s.year === currentYear && s.month >= currentMonth) return true;
    return false;
  });

  const relevantScans = Array.from(new Map(
    [...runningScans, ...currentAndFutureScans].map(s => [s.id, s] as [string, MonthStatus])
  ).values()).sort((a, b) => {
    if (a.status === "running" && b.status !== "running") return -1;
    if (b.status === "running" && a.status !== "running") return 1;
    if (a.year !== b.year) return a.year - b.year;
    return a.month - b.month;
  });

  if (relevantScans.length === 0) {
    return (
      <Card data-testid="plugin-wmb-scan-status">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Benefits Scan Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-4">
            No active or scheduled scans
          </p>
        </CardContent>
        <CardFooter className="pt-0">
          <Link href="/admin/wmb-scan-queue" className="w-full">
            <Button 
              variant="ghost" 
              className="w-full justify-between" 
              data-testid="button-manage-scans"
            >
              <span>Manage Scans</span>
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card data-testid="plugin-wmb-scan-status">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="h-5 w-5" />
          Benefits Scan Status
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {relevantScans.slice(0, 5).map((scan) => {
            const totalProcessed = scan.processedSuccess + scan.processedFailed;
            const progressPercent = scan.totalQueued > 0 ? (totalProcessed / scan.totalQueued) * 100 : 0;
            const isRunning = scan.status === "running";

            return (
              <Link 
                key={scan.id} 
                href={`/admin/wmb-scan-detail/${scan.id}`}
                data-testid={`scan-link-${scan.id}`}
              >
                <div className="p-3 rounded-md border hover-elevate active-elevate-2 cursor-pointer space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">
                        {MonthName(scan.month)} {scan.year}
                      </span>
                    </div>
                    <StatusBadge status={scan.status} />
                  </div>

                  {isRunning && (
                    <div className="space-y-1">
                      <Progress value={progressPercent} className="h-1.5" />
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>{totalProcessed} / {scan.totalQueued} workers</span>
                        <span>{Math.round(progressPercent)}%</span>
                      </div>
                    </div>
                  )}

                  {scan.status === "completed" && (
                    <div className="flex items-center gap-4 text-xs">
                      <div className="flex items-center gap-1 text-green-600 dark:text-green-400">
                        <TrendingUp className="h-3 w-3" />
                        <span>{scan.benefitsStarted} started</span>
                      </div>
                      <div className="flex items-center gap-1 text-muted-foreground">
                        <Minus className="h-3 w-3" />
                        <span>{scan.benefitsContinued} continued</span>
                      </div>
                      <div className="flex items-center gap-1 text-red-600 dark:text-red-400">
                        <TrendingDown className="h-3 w-3" />
                        <span>{scan.benefitsTerminated} ended</span>
                      </div>
                    </div>
                  )}

                  {scan.status === "queued" && (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      <span>{scan.totalQueued} workers queued</span>
                    </div>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      </CardContent>
      <CardFooter className="pt-0">
        <Link href="/admin/wmb-scan-queue" className="w-full">
          <Button 
            variant="ghost" 
            className="w-full justify-between" 
            data-testid="button-manage-scans"
          >
            <span>Manage All Scans</span>
            <ArrowRight className="h-4 w-4" />
          </Button>
        </Link>
      </CardFooter>
    </Card>
  );
}
