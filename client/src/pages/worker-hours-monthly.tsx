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

interface MonthlyHoursEntry {
  employerId: string;
  year: number;
  month: number;
  totalHours: number | null;
  employmentStatusId: string;
  allHome: boolean;
  anyHome: boolean;
  employer: Employer;
  employmentStatus: EmploymentStatus;
}

function WorkerHoursMonthlyContent() {
  const { worker } = useWorkerLayout();

  const { data: monthlyEntries = [], isLoading } = useQuery<MonthlyHoursEntry[]>({
    queryKey: ["/api/workers", worker.id, "hours", "monthly"],
    queryFn: async () => {
      const response = await fetch(`/api/workers/${worker.id}/hours?view=monthly`);
      if (!response.ok) throw new Error("Failed to fetch monthly hours");
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
        <CardTitle>Monthly Hours Summary</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : monthlyEntries.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No hours records found for this worker
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Month</TableHead>
                <TableHead>Employer</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Home</TableHead>
                <TableHead className="text-right">Total Hours</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {monthlyEntries.map((entry, index) => (
                <TableRow key={`${entry.employerId}-${entry.year}-${entry.month}`} data-testid={`row-monthly-${index}`}>
                    <TableCell data-testid={`text-date-${index}`}>
                      {getMonthName(entry.month)} {entry.year}
                    </TableCell>
                    <TableCell data-testid={`text-employer-${index}`}>
                      {entry.employer.name}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={entry.employmentStatus.employed ? "default" : "secondary"}
                        data-testid={`badge-status-${index}`}
                      >
                        {entry.employmentStatus.name}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {entry.allHome && (
                        <Badge variant="default" data-testid={`badge-home-${index}`}>
                          Home
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right" data-testid={`text-hours-${index}`}>
                      {entry.totalHours !== null ? entry.totalHours.toFixed(2) : "—"}
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

export default function WorkerHoursMonthly() {
  return (
    <WorkerLayout activeTab="monthly">
      <WorkerHoursMonthlyContent />
    </WorkerLayout>
  );
}
