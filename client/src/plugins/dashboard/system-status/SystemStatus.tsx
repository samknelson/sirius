import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { Activity, ArrowRight, AlertTriangle, XCircle, CheckCircle2 } from "lucide-react";
import { DashboardPluginProps } from "../registry";
import { useDashboardContent } from "../useDashboardContent";

type StatusPriority = "info" | "notice" | "warning" | "error";

interface SystemStatusContent {
  statuses: Array<{
    id: string;
    name: string;
    worstPriority: StatusPriority;
    scannedAt: string;
  }>;
  warningCount: number;
  errorCount: number;
  problems: Array<{
    pluginId: string;
    pluginName: string;
    priority: StatusPriority;
    title: string;
    details?: string;
  }>;
}

function PriorityBadge({ priority }: { priority: StatusPriority }) {
  switch (priority) {
    case "error":
      return <Badge variant="destructive">Error</Badge>;
    case "warning":
      return (
        <Badge className="bg-yellow-500 hover:bg-yellow-500/90 text-white">Warning</Badge>
      );
    case "notice":
      return <Badge variant="secondary">Notice</Badge>;
    default:
      return <Badge variant="outline">OK</Badge>;
  }
}

export function SystemStatus(_props: DashboardPluginProps) {
  const { data, isLoading } = useDashboardContent<SystemStatusContent>("system-status");

  if (!data && isLoading) {
    return (
      <Card data-testid="widget-system-status">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4" />
            System Status
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-5 w-2/3" />
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  const healthy = data.errorCount === 0 && data.warningCount === 0;

  return (
    <Card data-testid="widget-system-status">
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-base">
          <span className="flex items-center gap-2">
            <Activity className="h-4 w-4" />
            System Status
          </span>
          <Link
            href="/config/system-status"
            className="text-sm font-normal text-muted-foreground hover:text-foreground flex items-center gap-1"
            data-testid="link-system-status-page"
          >
            Details <ArrowRight className="h-3 w-3" />
          </Link>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {healthy ? (
          <div
            className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400"
            data-testid="text-system-status-healthy"
          >
            <CheckCircle2 className="h-4 w-4" />
            All {data.statuses.length} checks passing
          </div>
        ) : (
          <div className="flex items-center gap-3 text-sm" data-testid="text-system-status-rollup">
            {data.errorCount > 0 && (
              <span className="flex items-center gap-1 text-destructive">
                <XCircle className="h-4 w-4" />
                {data.errorCount} error{data.errorCount === 1 ? "" : "s"}
              </span>
            )}
            {data.warningCount > 0 && (
              <span className="flex items-center gap-1 text-yellow-600 dark:text-yellow-400">
                <AlertTriangle className="h-4 w-4" />
                {data.warningCount} warning{data.warningCount === 1 ? "" : "s"}
              </span>
            )}
          </div>
        )}
        {data.problems.length > 0 && (
          <ul className="space-y-2">
            {data.problems.slice(0, 5).map((p, i) => (
              <li
                key={`${p.pluginId}-${i}`}
                className="flex items-start gap-2 text-sm"
                data-testid={`row-system-status-problem-${p.pluginId}-${i}`}
              >
                <PriorityBadge priority={p.priority} />
                <span>
                  <span className="font-medium">{p.pluginName}:</span> {p.title}
                </span>
              </li>
            ))}
            {data.problems.length > 5 && (
              <li className="text-xs text-muted-foreground">
                +{data.problems.length - 5} more — see the status page.
              </li>
            )}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
