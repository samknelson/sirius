import { useState } from "react";
import { useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { DispatchJobLayout } from "@/components/layouts/DispatchJobLayout";
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

interface JobInterviewRow extends T631InterviewRow {
  workerId: string;
  worker: {
    id: string;
    siriusId: number;
    name: string;
    email: string | null;
    phone: string | null;
  } | null;
}

interface JobInterviewsResponse {
  job: { id: string; title: string; employerName: string | null };
  viewer: { isStaff: boolean; isEmployer: boolean };
  interviews: JobInterviewRow[];
}

function JobInterviewsContent({ jobId }: { jobId: string }) {
  const queryKey = [`/api/sitespecific/t631/interviews/views/job/${jobId}`];
  const { data, isLoading, isError } = useQuery<JobInterviewsResponse>({ queryKey });
  const [selected, setSelected] = useState<JobInterviewRow | null>(null);

  if (isLoading) {
    return <Skeleton className="h-64 w-full" data-testid="skeleton-job-interviews" />;
  }
  if (isError || !data) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground" data-testid="text-error">
          Unable to load interviews for this job.
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users size={18} /> Interviews
          </CardTitle>
          <CardDescription>
            {data.viewer.isStaff
              ? "All interviews for this job."
              : "Interviews for this job (accepted, passed, and failed)."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data.interviews.length === 0 ? (
            <p className="text-muted-foreground text-center py-8" data-testid="text-no-interviews">
              No interviews for this job.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Worker</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.interviews.map((row) => (
                  <TableRow key={row.id} data-testid={`row-interview-${row.id}`}>
                    <TableCell data-testid={`text-worker-name-${row.id}`}>
                      {row.worker?.name ?? "Unknown"}
                    </TableCell>
                    <TableCell>{row.worker?.email ?? "—"}</TableCell>
                    <TableCell>{row.worker?.phone ?? "—"}</TableCell>
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

/**
 * Staff render inside the standard job layout (tabs, header). Employers
 * can't fetch the staff-only job endpoint the layout uses, so they get a
 * standalone header from the interviews view payload instead.
 */
export default function DispatchJobT631InterviewsPage() {
  const { id } = useParams<{ id: string }>();
  const { hasPermission } = useAuth();

  if (hasPermission("staff")) {
    return (
      <DispatchJobLayout activeTab="sitespecific-t631-interviews-list">
        <JobInterviewsContent jobId={id!} />
      </DispatchJobLayout>
    );
  }

  return <EmployerJobInterviews jobId={id!} />;
}

function EmployerJobInterviews({ jobId }: { jobId: string }) {
  const { data } = useQuery<JobInterviewsResponse>({
    queryKey: [`/api/sitespecific/t631/interviews/views/job/${jobId}`],
  });
  usePageTitle(data ? `Interviews — ${data.job.title}` : "Interviews");

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-4">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-job-title">
          {data?.job.title ?? "Job Interviews"}
        </h1>
        {data?.job.employerName && (
          <p className="text-muted-foreground" data-testid="text-employer-name">
            {data.job.employerName}
          </p>
        )}
      </div>
      <JobInterviewsContent jobId={jobId} />
    </div>
  );
}
