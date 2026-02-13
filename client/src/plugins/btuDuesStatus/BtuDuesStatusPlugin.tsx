import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import {
  DollarSign,
  ArrowRight,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  SkipForward,
  FileCheck,
} from "lucide-react";
import { DashboardPluginProps } from "../types";
import { format } from "date-fns";

interface DuesSummary {
  hasData: boolean;
  wizardId?: string;
  wizardName?: string;
  status?: string;
  date?: string;
  processResults?: {
    totalRows: number;
    successCount: number;
    failureCount: number;
    completedAt: string | null;
  };
  skippedDuplicateCount?: number;
  comparisonReport?: {
    matchingRate: number;
    mismatchingRate: number;
    noCardCheck: number;
    cardCheckMissingRate: number;
    cardCheckNoAllocation: number;
    workerNotFound: number;
  };
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { variant: "default" | "secondary" | "outline" | "destructive"; label: string }> = {
    completed: { variant: "outline", label: "Completed" },
    completed_with_errors: { variant: "destructive", label: "Completed with Errors" },
    processing: { variant: "default", label: "Processing" },
    in_progress: { variant: "secondary", label: "In Progress" },
    failed: { variant: "destructive", label: "Failed" },
  };

  const c = config[status] || { variant: "outline", label: status };
  return <Badge variant={c.variant}>{c.label}</Badge>;
}

function StatRow({ icon, label, value, muted }: { icon: JSX.Element; label: string; value: number | string; muted?: boolean }) {
  return (
    <div className={`flex items-center justify-between py-1 ${muted ? 'text-muted-foreground' : ''}`}>
      <div className="flex items-center gap-2 text-sm">
        {icon}
        <span>{label}</span>
      </div>
      <span className="text-sm font-medium tabular-nums">{value}</span>
    </div>
  );
}

export function BtuDuesStatusPlugin({ userPermissions, enabledComponents }: DashboardPluginProps) {
  const hasPermission = userPermissions.includes("admin");
  const hasComponent = enabledComponents?.includes("sitespecific.btu") ?? false;

  const { data: summary, isLoading } = useQuery<DuesSummary>({
    queryKey: ["/api/dashboard-plugins/btu-dues-status/summary"],
    enabled: hasPermission && hasComponent,
  });

  if (!hasPermission || !hasComponent) return null;
  if (isLoading) return null;
  if (!summary?.hasData) return null;

  const { processResults, comparisonReport, skippedDuplicateCount = 0 } = summary;
  const isFinished = summary.status === 'completed' || summary.status === 'completed_with_errors';

  return (
    <Card data-testid="card-btu-dues-status">
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <DollarSign className="h-4 w-4 text-muted-foreground" />
          BTU Dues Status
        </CardTitle>
        <StatusBadge status={summary.status || 'unknown'} />
      </CardHeader>
      <CardContent className="space-y-3">
        {summary.date && (
          <p className="text-xs text-muted-foreground" data-testid="text-dues-date">
            {format(new Date(summary.date), "MMM d, yyyy")}
          </p>
        )}

        {processResults && isFinished && (
          <div className="space-y-0.5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider pb-1">Import Results</p>
            <StatRow
              icon={<FileCheck className="h-3.5 w-3.5 text-muted-foreground" />}
              label="Total Rows"
              value={processResults.totalRows}
            />
            <StatRow
              icon={<CheckCircle2 className="h-3.5 w-3.5 text-green-600" />}
              label="Allocated"
              value={processResults.successCount}
            />
            {processResults.failureCount > 0 && (
              <StatRow
                icon={<XCircle className="h-3.5 w-3.5 text-destructive" />}
                label="Failed"
                value={processResults.failureCount}
              />
            )}
            {skippedDuplicateCount > 0 && (
              <StatRow
                icon={<SkipForward className="h-3.5 w-3.5 text-muted-foreground" />}
                label="Skipped (Duplicate)"
                value={skippedDuplicateCount}
                muted
              />
            )}
          </div>
        )}

        {comparisonReport && isFinished && (
          <div className="space-y-0.5 pt-1 border-t">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider pb-1">Card Check Comparison</p>
            <StatRow
              icon={<CheckCircle2 className="h-3.5 w-3.5 text-green-600" />}
              label="Matching Rate"
              value={comparisonReport.matchingRate}
            />
            {comparisonReport.mismatchingRate > 0 && (
              <StatRow
                icon={<AlertTriangle className="h-3.5 w-3.5 text-yellow-600" />}
                label="Mismatching Rate"
                value={comparisonReport.mismatchingRate}
              />
            )}
            {comparisonReport.noCardCheck > 0 && (
              <StatRow
                icon={<XCircle className="h-3.5 w-3.5 text-muted-foreground" />}
                label="No Card Check"
                value={comparisonReport.noCardCheck}
                muted
              />
            )}
            {comparisonReport.cardCheckNoAllocation > 0 && (
              <StatRow
                icon={<Clock className="h-3.5 w-3.5 text-muted-foreground" />}
                label="Card Check, No Allocation"
                value={comparisonReport.cardCheckNoAllocation}
                muted
              />
            )}
            {comparisonReport.workerNotFound > 0 && (
              <StatRow
                icon={<AlertTriangle className="h-3.5 w-3.5 text-destructive" />}
                label="Worker Not Found"
                value={comparisonReport.workerNotFound}
              />
            )}
          </div>
        )}

        {!isFinished && (
          <p className="text-sm text-muted-foreground">
            Import is currently {summary.status === 'processing' ? 'being processed' : 'in progress'}...
          </p>
        )}
      </CardContent>
      {summary.wizardId && (
        <CardFooter className="pt-0">
          <Link href={`/wizards/${summary.wizardId}`}>
            <Button variant="ghost" size="sm" className="gap-1 -ml-2" data-testid="button-view-dues-details">
              View Details
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </Link>
        </CardFooter>
      )}
    </Card>
  );
}
