import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Clock, Play, Eye, Calendar, Activity } from "lucide-react";
import { format } from "date-fns";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface CronJobRun {
  id: string;
  jobId: string;
  status: string;
  output: string | null;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
  triggeredBy: string | null;
}

interface CronJob {
  id: string;
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

function RunHistoryDialog({ job }: { job: CronJob }) {
  const { data: runs = [], isLoading } = useQuery<CronJobRun[]>({
    queryKey: ["/api/cron-jobs", job.id, "runs"],
    queryFn: async () => {
      const response = await fetch(`/api/cron-jobs/${job.id}/runs`);
      if (!response.ok) throw new Error('Failed to fetch run history');
      return response.json();
    },
  });

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" data-testid={`button-view-history-${job.id}`}>
          <Eye className="h-4 w-4 mr-2" />
          View History
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Run History: {job.name}</DialogTitle>
          <DialogDescription>
            View all execution history for this cron job
          </DialogDescription>
        </DialogHeader>
        
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        ) : runs.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            No runs yet. This job hasn't been executed.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Started</TableHead>
                <TableHead>Completed</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Triggered By</TableHead>
                <TableHead>Output/Error</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((run) => (
                <TableRow key={run.id}>
                  <TableCell className="text-sm">
                    {format(new Date(run.startedAt), "MMM d, yyyy HH:mm:ss")}
                  </TableCell>
                  <TableCell className="text-sm">
                    {run.completedAt ? format(new Date(run.completedAt), "MMM d, yyyy HH:mm:ss") : "—"}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={run.status} />
                  </TableCell>
                  <TableCell className="text-sm">
                    {run.triggeredBy || "Scheduler"}
                  </TableCell>
                  <TableCell className="text-sm max-w-xs truncate">
                    {run.error || run.output || "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function CronJobs() {
  const { toast } = useToast();

  const { data: jobs = [], isLoading } = useQuery<CronJob[]>({
    queryKey: ["/api/cron-jobs"],
  });

  const runMutation = useMutation({
    mutationFn: async (jobId: string) => {
      return await apiRequest("POST", `/api/cron-jobs/${jobId}/run`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cron-jobs"] });
      toast({
        title: "Job Started",
        description: "The cron job has been manually triggered.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to Run Job",
        description: error.message || "Failed to trigger the cron job",
        variant: "destructive",
      });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, isEnabled }: { id: string; isEnabled: boolean }) => {
      return await apiRequest("PATCH", `/api/cron-jobs/${id}`, { isEnabled });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cron-jobs"] });
      toast({
        title: "Job Updated",
        description: "Cron job status has been updated.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to Update Job",
        description: error.message || "Failed to update cron job",
        variant: "destructive",
      });
    },
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
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map((job) => (
                  <TableRow key={job.id}>
                    <TableCell>
                      <div>
                        <div className="font-medium" data-testid={`text-job-name-${job.id}`}>
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
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={job.isEnabled}
                          onCheckedChange={(checked) => 
                            toggleMutation.mutate({ id: job.id, isEnabled: checked })
                          }
                          disabled={toggleMutation.isPending}
                          data-testid={`switch-enabled-${job.id}`}
                        />
                        <span className="text-sm text-muted-foreground">
                          {job.isEnabled ? "Enabled" : "Disabled"}
                        </span>
                      </div>
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
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => runMutation.mutate(job.id)}
                          disabled={runMutation.isPending}
                          data-testid={`button-run-${job.id}`}
                        >
                          <Play className="h-4 w-4 mr-2" />
                          Run Now
                        </Button>
                        <RunHistoryDialog job={job} />
                      </div>
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
