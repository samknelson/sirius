import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { CalendarClock } from "lucide-react";
import { WorkerLayout, useWorkerLayout } from "@/components/layouts/WorkerLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { queryClient } from "@/lib/queryClient";
import {
  InterviewStatusModal,
  T631_STATUS_BADGE,
  type T631InterviewRow,
} from "@/components/sitespecific/t631/InterviewStatusModal";

interface WorkerInterviewRow extends T631InterviewRow {
  jobId: string;
  job: {
    id: string;
    title: string;
    employerName: string | null;
    facilityName: string | null;
    startDate: string | null;
    description: string | null;
  } | null;
}

interface WorkerInterviewsResponse {
  viewer: { isStaff: boolean; isSelf: boolean };
  interviews: WorkerInterviewRow[];
}

function WorkerInterviewsContent() {
  const { worker } = useWorkerLayout();
  const queryKey = [`/api/sitespecific/t631/interviews/views/worker/${worker.id}`];
  const { data, isLoading, isError } = useQuery<WorkerInterviewsResponse>({ queryKey });
  const [selected, setSelected] = useState<WorkerInterviewRow | null>(null);

  if (isLoading) {
    return <Skeleton className="h-64 w-full" data-testid="skeleton-worker-interviews" />;
  }
  if (isError || !data) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground" data-testid="text-error">
          Unable to load interviews.
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarClock size={18} /> Interviews
          </CardTitle>
          <CardDescription>Job interviews for this worker.</CardDescription>
        </CardHeader>
        <CardContent>
          {data.interviews.length === 0 ? (
            <p className="text-muted-foreground text-center py-8" data-testid="text-no-interviews">
              No interviews.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employer</TableHead>
                  <TableHead>Facility</TableHead>
                  <TableHead>Start Date</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.interviews.map((row) => (
                  <TableRow key={row.id} data-testid={`row-interview-${row.id}`}>
                    <TableCell data-testid={`text-employer-${row.id}`}>
                      {row.job?.employerName ?? "—"}
                    </TableCell>
                    <TableCell>{row.job?.facilityName ?? "—"}</TableCell>
                    <TableCell>
                      {row.job?.startDate ? format(new Date(row.job.startDate), "PP") : "—"}
                    </TableCell>
                    <TableCell className="max-w-xs truncate">
                      {row.job?.description ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Badge className={T631_STATUS_BADGE[row.status]} data-testid={`badge-status-${row.id}`}>
                        {row.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setSelected(row)}
                        data-testid={`button-open-${row.id}`}
                      >
                        Open
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <InterviewStatusModal
        interview={selected}
        onClose={() => setSelected(null)}
        onSaved={() => queryClient.invalidateQueries({ queryKey })}
      />
    </>
  );
}

export default function WorkerDispatchT631InterviewsPage() {
  return (
    <WorkerLayout activeTab="dispatch-t631-interviews">
      <WorkerInterviewsContent />
    </WorkerLayout>
  );
}
