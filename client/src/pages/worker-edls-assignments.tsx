import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { WorkerLayout, useWorkerLayout } from "@/components/layouts/WorkerLayout";
import { useAuth } from "@/contexts/AuthContext";
import { formatYmd } from "@shared/utils/date";

/**
 * One row of the worker's schedule, as narrowed by
 * GET /api/workers/:id/edls/assignments.
 */
interface WorkerEdlsAssignment {
  assignmentId: string;
  ymd: string;
  sheetId: string;
  sheetTitle: string;
  sheetStatus: string;
  crewTitle: string;
  /** The sheet's job group, shown as "Event". Null when job groups are off. */
  jobGroup: { id: string; name: string } | null;
  facility: { id: string; name: string } | null;
  department: { id: string; name: string } | null;
}

/** Matches the sheets list: draft is muted, everything else reads as settled. */
function statusVariant(status: string): "default" | "secondary" | "outline" {
  if (status === "draft") return "outline";
  if (status === "lock") return "default";
  return "secondary";
}

function WorkerEdlsAssignmentsContent() {
  const { worker } = useWorkerLayout();
  const { hasComponent } = useAuth();
  const componentEnabled = hasComponent("edls");
  // The endpoint returns a null job group when this component is off, so the
  // column is dropped entirely rather than rendering a row of dashes.
  const showEvent = hasComponent("dispatch.job_group");

  const { data, isLoading, isError } = useQuery<WorkerEdlsAssignment[]>({
    queryKey: ["/api/workers", worker.id, "edls", "assignments"],
    enabled: componentEnabled,
  });

  if (!componentEnabled) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Assignments</CardTitle>
          <CardDescription>EDLS is not available for this site.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  // Newest first: the list runs back through every sheet this worker has ever
  // been on, and the useful end is the one nearest today.
  const assignments = [...(data ?? [])].reverse();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Assignments</CardTitle>
        <CardDescription>
          Every crew this worker is assigned to — past, present and future.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : isError ? (
          <p className="text-sm text-destructive" data-testid="text-assignments-error">
            Could not load this worker's assignments.
          </p>
        ) : assignments.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="text-no-assignments">
            This worker has no EDLS assignments.
          </p>
        ) : (
          <Table data-testid="table-edls-assignments">
            <TableHeader>
              <TableRow>
                <TableHead>Status</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Sheet</TableHead>
                <TableHead>Crew</TableHead>
                {showEvent && <TableHead>Event</TableHead>}
                <TableHead>Facility</TableHead>
                <TableHead>Department</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {assignments.map((a) => (
                <TableRow key={a.assignmentId} data-testid={`row-assignment-${a.assignmentId}`}>
                  <TableCell>
                    <Badge variant={statusVariant(a.sheetStatus)} data-testid={`badge-status-${a.assignmentId}`}>
                      {a.sheetStatus}
                    </Badge>
                  </TableCell>
                  <TableCell data-testid={`text-date-${a.assignmentId}`}>{formatYmd(a.ymd)}</TableCell>
                  <TableCell data-testid={`text-sheet-${a.assignmentId}`}>{a.sheetTitle}</TableCell>
                  <TableCell data-testid={`text-crew-${a.assignmentId}`}>{a.crewTitle}</TableCell>
                  {showEvent && (
                    <TableCell data-testid={`text-event-${a.assignmentId}`}>
                      {a.jobGroup?.name || "—"}
                    </TableCell>
                  )}
                  <TableCell data-testid={`text-facility-${a.assignmentId}`}>
                    {a.facility?.name || "—"}
                  </TableCell>
                  <TableCell data-testid={`text-department-${a.assignmentId}`}>
                    {a.department?.name || "—"}
                  </TableCell>
                  <TableCell>
                    <Link href={`/edls/sheet/${a.sheetId}`}>
                      <Button
                        variant="ghost"
                        size="sm"
                        title="View sheet"
                        data-testid={`link-sheet-${a.assignmentId}`}
                      >
                        <ExternalLink size={16} />
                      </Button>
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

export default function WorkerEdlsAssignments() {
  return (
    <WorkerLayout activeTab="edls-assignments">
      <WorkerEdlsAssignmentsContent />
    </WorkerLayout>
  );
}
