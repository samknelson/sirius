import { useQuery } from "@tanstack/react-query";
import { useParams } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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

interface CronJob {
  name: string;
  description: string | null;
  schedule: string;
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
  latestRun?: CronJobRun;
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

function formatSummaryValue(value: any): React.ReactNode {
  if (typeof value === 'object' && value !== null) {
    if (Array.isArray(value)) {
      return (
        <div className="space-y-1">
          {value.map((item, idx) => (
            <div key={idx} className="text-xs">• {formatSummaryValue(item)}</div>
          ))}
        </div>
      );
    }
    // For objects, show as key-value pairs
    return (
      <div className="space-y-1">
        {Object.entries(value).map(([k, v]) => (
          <div key={k} className="text-xs">
            <span className="font-medium">{k}:</span> {typeof v === 'object' ? JSON.stringify(v) : String(v)}
          </div>
        ))}
      </div>
    );
  }
  return String(value);
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
              {(() => {
                const outputData = parseOutputData(job.latestRun.output);
                return outputData && (
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Execution Time</p>
                    <p className="text-sm mt-1" data-testid="text-execution-time">
                      {outputData.executionTimeSec} seconds
                    </p>
                  </div>
                );
              })()}
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

            {(() => {
              const outputData = parseOutputData(job.latestRun.output);
              return outputData && outputData.summary && (
                <div className="border-t pt-4">
                  <p className="text-sm font-medium text-muted-foreground mb-3">Summary</p>
                  <div className="grid grid-cols-2 gap-4">
                    {Object.entries(outputData.summary).map(([key, value]) => (
                      <div key={key}>
                        <p className="text-sm font-medium text-muted-foreground capitalize">
                          {key.replace(/([A-Z])/g, ' $1').trim()}
                        </p>
                        <div className="text-sm mt-1" data-testid={`summary-${key}`}>
                          {formatSummaryValue(value)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            {job.latestRun.error && (
              <div className="border-t pt-4">
                <p className="text-sm font-medium text-muted-foreground mb-2">Error</p>
                <pre className="text-sm bg-destructive/10 text-destructive p-4 rounded-md overflow-x-auto" data-testid="text-error">
                  {job.latestRun.error}
                </pre>
              </div>
            )}

            {!parseOutputData(job.latestRun.output) && job.latestRun.output && !job.latestRun.error && (
              <div className="border-t pt-4">
                <p className="text-sm font-medium text-muted-foreground mb-2">Output</p>
                <pre className="text-sm bg-muted p-4 rounded-md overflow-x-auto" data-testid="text-output">
                  {job.latestRun.output}
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
