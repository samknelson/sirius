import { useQuery } from "@tanstack/react-query";
import { useParams } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { format } from "date-fns";
import { CronJobLayout } from "@/components/layouts/CronJobLayout";

interface CronJobRun {
  id: string;
  jobName: string;
  status: string;
  mode: string;
  output: string | null;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
  triggeredBy: string | null;
  userFirstName?: string | null;
  userLastName?: string | null;
  userEmail?: string | null;
}

interface CronJobOutputData {
  executionTimeMs: number;
  executionTimeSec: string;
  summary: {
    [key: string]: any;
  };
}

function StatusBadge({ status }: { status: string }) {
  const variant = 
    status === 'success' ? 'default' : 
    status === 'error' ? 'destructive' : 
    status === 'running' ? 'secondary' : 
    'outline';
  
  return <Badge variant={variant} data-testid={`badge-status-${status}`}>{status}</Badge>;
}

function formatTriggeredBy(run: CronJobRun): string {
  if (!run.triggeredBy || run.triggeredBy === 'scheduler') {
    return 'Scheduler';
  }
  
  if (run.userEmail) {
    const fullName = [run.userFirstName, run.userLastName].filter(Boolean).join(' ');
    return fullName ? `${fullName} (${run.userEmail})` : run.userEmail;
  }
  
  return run.triggeredBy;
}

function parseOutputData(output: string | null): CronJobOutputData | null {
  if (!output) return null;
  try {
    return JSON.parse(output);
  } catch {
    return null;
  }
}

function CronJobHistoryContent() {
  const { name } = useParams<{ name: string }>();

  const { data: runs = [], isLoading } = useQuery<CronJobRun[]>({
    queryKey: ["/api/cron-jobs", name, "runs"],
    queryFn: async () => {
      const response = await fetch(`/api/cron-jobs/${encodeURIComponent(name!)}/runs`);
      if (!response.ok) throw new Error('Failed to fetch run history');
      return response.json();
    },
    enabled: !!name,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Run History</CardTitle>
        <CardDescription>Complete execution history for this job</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        ) : runs.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8" data-testid="text-no-history">
            No runs yet. This job hasn't been executed.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Started</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Mode</TableHead>
                <TableHead>Triggered By</TableHead>
                <TableHead>Summary</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((run) => {
                const outputData = parseOutputData(run.output);
                return (
                  <TableRow key={run.id} data-testid={`row-run-${run.id}`}>
                    <TableCell className="text-sm">
                      {format(new Date(run.startedAt), "MMM d, HH:mm:ss")}
                    </TableCell>
                    <TableCell className="text-sm">
                      {outputData ? `${outputData.executionTimeSec}s` : "—"}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={run.status} />
                    </TableCell>
                    <TableCell>
                      {run.mode === 'test' ? (
                        <Badge variant="outline">Test</Badge>
                      ) : (
                        <Badge variant="default">Live</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      {formatTriggeredBy(run)}
                    </TableCell>
                    <TableCell className="text-sm">
                      {run.error ? (
                        <span className="text-destructive truncate block max-w-xs">Error: {run.error}</span>
                      ) : outputData?.summary ? (
                        <div className="space-x-2">
                          {outputData.summary.totalDeleted !== undefined && (
                            <span className="font-mono">{outputData.summary.totalDeleted} deleted</span>
                          )}
                          {outputData.summary.totalWizardsChecked !== undefined && (
                            <span className="text-muted-foreground">({outputData.summary.totalWizardsChecked} checked)</span>
                          )}
                        </div>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

export default function CronJobHistory() {
  return (
    <CronJobLayout activeTab="history">
      <CronJobHistoryContent />
    </CronJobLayout>
  );
}
