import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Clock, ChevronRight, Calendar } from "lucide-react";
import { format } from "date-fns";

interface CronJobRun {
  id: string;
  jobName: string;
  status: string;
  startedAt: string;
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

export default function CronJobs() {
  const { data: jobs = [], isLoading } = useQuery<CronJob[]>({
    queryKey: ["/api/cron-jobs"],
  });

  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Skeleton className="h-10 w-64 mb-8" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-foreground">Cron Jobs</h1>
        <p className="text-muted-foreground mt-2">
          Manage scheduled tasks and view execution history.
        </p>
      </div>

      {jobs.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <div className="text-center">
              <Clock className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No Cron Jobs</h3>
              <p className="text-sm text-muted-foreground">
                No scheduled jobs configured yet.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Scheduled Jobs</CardTitle>
            <CardDescription>
              View and manage all configured cron jobs
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Schedule</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Latest Run</TableHead>
                  <TableHead>Last Status</TableHead>
                  <TableHead className="w-[100px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map((job) => (
                  <TableRow key={job.name}>
                    <TableCell>
                      <div>
                        <div className="font-medium" data-testid={`text-job-name-${job.name}`}>
                          {job.name}
                        </div>
                        {job.description && (
                          <div className="text-sm text-muted-foreground">
                            {job.description}
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {job.schedule}
                    </TableCell>
                    <TableCell>
                      <Badge variant={job.isEnabled ? "default" : "secondary"} data-testid={`badge-enabled-${job.name}`}>
                        {job.isEnabled ? "Enabled" : "Disabled"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      {job.latestRun ? (
                        <div className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {format(new Date(job.latestRun.startedAt), "MMM d, HH:mm")}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">Never</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {job.latestRun ? (
                        <StatusBadge status={job.latestRun.status} />
                      ) : (
                        <span className="text-muted-foreground text-sm">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Link href={`/cron-jobs/${encodeURIComponent(job.name)}`}>
                        <Button variant="ghost" size="sm" data-testid={`button-view-${job.name}`}>
                          View
                          <ChevronRight className="h-4 w-4 ml-1" />
                        </Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
