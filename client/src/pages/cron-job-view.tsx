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
  output: string | null;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
  triggeredBy: string | null;
  userFirstName?: string | null;
  userLastName?: string | null;
  userEmail?: string | null;
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
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Status</p>
                <div className="mt-1">
                  <StatusBadge status={job.latestRun.status} />
                </div>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Triggered By</p>
                <p className="text-sm mt-1" data-testid="text-triggered-by">
                  {formatTriggeredBy(job.latestRun)}
                </p>
              </div>
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
            {(job.latestRun.output || job.latestRun.error) && (
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-2">
                  {job.latestRun.error ? "Error" : "Output"}
                </p>
                <pre className="text-sm bg-muted p-4 rounded-md overflow-x-auto" data-testid="text-output">
                  {job.latestRun.error || job.latestRun.output}
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
