import { useQuery } from "@tanstack/react-query";
import { useParams } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "@/lib/date-format";
import { CronJobLayout } from "@/components/layouts/CronJobLayout";
import { CronJob, CronJobRun } from "@/lib/cron-types";

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

function parseOutputData(output: string | null) {
  if (!output) return null;
  try {
    const value: unknown = JSON.parse(output);
    const seconds = value !== null && typeof value === "object" && "executionTimeSec" in value
      ? value.executionTimeSec
      : undefined;
    return {
      value,
      executionTimeSec: typeof seconds === "string" || typeof seconds === "number" ? seconds : undefined,
    };
  } catch {
    return null;
  }
}

function CronJobViewContent() {
  const { name } = useParams<{ name: string }>();

  const { data: job, isLoading } = useQuery<CronJob>({
    queryKey: ["/api/cron-jobs", name],
    queryFn: async () => {
      const response = await fetch(`/api/cron-jobs/${encodeURIComponent(name!)}`);
      if (!response.ok) throw new Error('Failed to fetch cron job');
      return response.json();
    },
    enabled: !!name,
  });
  const outputData = parseOutputData(job?.latestRun?.output ?? null);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Latest Run</CardTitle>
          <CardDescription>Most recent execution status and details</CardDescription>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-32" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Latest Run</CardTitle>
        <CardDescription>Most recent execution status and details</CardDescription>
      </CardHeader>
      <CardContent>
        {job?.latestRun ? (
          <div className="space-y-6">
            {!job.latestRun.configurationId && (
              <p className="text-sm text-muted-foreground">
                Historical run: the original configuration cannot be identified.
              </p>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Status</p>
                <div className="mt-1">
                  <StatusBadge status={job.latestRun.status} />
                </div>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Mode</p>
                <p className="text-sm mt-1" data-testid="text-mode">
                  {job.latestRun.mode === 'test' ? (
                    <Badge variant="outline">Test Mode</Badge>
                  ) : (
                    <Badge variant="default">Live Mode</Badge>
                  )}
                </p>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Triggered By</p>
                <p className="text-sm mt-1" data-testid="text-triggered-by">
                  {formatTriggeredBy(job.latestRun)}
                </p>
              </div>
              {outputData?.executionTimeSec !== undefined && (
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Execution Time</p>
                  <p className="text-sm mt-1" data-testid="text-execution-time">
                    {outputData.executionTimeSec} seconds
                  </p>
                </div>
              )}
              <div>
                <p className="text-sm font-medium text-muted-foreground">Started At</p>
                <p className="text-sm mt-1" data-testid="text-started-at">
                  {format(new Date(job.latestRun.startedAt), "MMM d, yyyy HH:mm:ss")}
                </p>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Completed At</p>
                <p className="text-sm mt-1" data-testid="text-completed-at">
                  {job.latestRun.completedAt 
                    ? format(new Date(job.latestRun.completedAt), "MMM d, yyyy HH:mm:ss")
                    : "In Progress"}
                </p>
              </div>
            </div>

            {job.latestRun.output && (
              <div className="border-t pt-4">
                <p className="text-sm font-medium text-muted-foreground mb-2">Output</p>
                <pre className="text-sm bg-muted p-4 rounded-md max-h-[60vh] overflow-auto whitespace-pre" data-testid="text-output">
                  {outputData ? JSON.stringify(outputData.value, null, 2) : job.latestRun.output}
                </pre>
              </div>
            )}

            {job.latestRun.error && (
              <div className="border-t pt-4">
                <p className="text-sm font-medium text-muted-foreground mb-2">Error</p>
                <pre className="text-sm bg-destructive/10 text-destructive p-4 rounded-md overflow-x-auto" data-testid="text-error">
                  {job.latestRun.error}
                </pre>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-8" data-testid="text-no-runs">
            No runs yet. This job hasn't been executed.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default function CronJobView() {
  return (
    <CronJobLayout activeTab="view">
      <CronJobViewContent />
    </CronJobLayout>
  );
}
