import { useQuery } from "@tanstack/react-query";
import { Employer } from "@shared/schema";
import { WorkerLayout, useWorkerLayout } from "@/components/layouts/WorkerLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmploymentStatus } from "@/lib/entity-types";

interface EmploymentHistoryEntry {
  id: string;
  month: number;
  year: number;
  day: number;
  workerId: string;
  employerId: string;
  employmentStatusId: string;
  home: boolean;
  employer: Employer;
  employmentStatus: EmploymentStatus;
}

function WorkerEmploymentHistoryContent() {
  const { worker } = useWorkerLayout();

  const { data: historyEntries = [], isLoading } = useQuery<EmploymentHistoryEntry[]>({
    queryKey: ["/api/workers", worker.id, "hours", "history"],
    queryFn: async () => {
      const response = await fetch(`/api/workers/${worker.id}/hours?view=history`);
      if (!response.ok) throw new Error("Failed to fetch employment history");
      return response.json();
    },
  });

  const getMonthName = (month: number) => {
    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    return monthNames[month - 1];
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Employment Status Change History</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : historyEntries.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No status changes recorded for this worker
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employer</TableHead>
                <TableHead>Status Changed To</TableHead>
                <TableHead>Home</TableHead>
                <TableHead>Effective Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {historyEntries.map((entry) => (
                <TableRow key={entry.id} data-testid={`row-history-${entry.id}`}>
                  <TableCell data-testid={`text-employer-${entry.id}`}>
                    {entry.employer.name}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={entry.employmentStatus.employed ? "default" : "secondary"}
                      data-testid={`badge-status-${entry.id}`}
                    >
                      {entry.employmentStatus.name}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {entry.home && (
                      <Badge variant="default" data-testid={`badge-home-${entry.id}`}>
                        Home
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell data-testid={`text-date-${entry.id}`}>
                    {getMonthName(entry.month)} {entry.year}
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

export default function WorkerEmploymentHistory() {
  return (
    <WorkerLayout activeTab="history">
      <WorkerEmploymentHistoryContent />
    </WorkerLayout>
  );
}
