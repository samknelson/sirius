import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { EmployerLayout, useEmployerLayout } from "@/components/layouts/EmployerLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Users } from "lucide-react";
import { Link } from "wouter";
import { EmploymentStatus } from "@/lib/entity-types";

interface EmployerWorker {
  workerId: string;
  workerSiriusId: number;
  contactName: string;
  employmentHistoryId: string;
  employmentStatusId: string | null;
  employmentStatusName: string | null;
  position: string | null;
  date: string | null;
  home: boolean;
}

function EmployerWorkersContent() {
  const { employer } = useEmployerLayout();
  const [employmentStatusFilter, setEmploymentStatusFilter] = useState<string>("all");

  const { data: employmentStatuses } = useQuery<EmploymentStatus[]>({
    queryKey: ["/api/options/employment-status"],
  });

  const { data: workers, isLoading } = useQuery<EmployerWorker[]>({
    queryKey: employmentStatusFilter === "all" 
      ? ["/api/employers", employer.id, "workers"]
      : ["/api/employers", employer.id, "workers", { employmentStatusId: employmentStatusFilter }],
    queryFn: async () => {
      const url = employmentStatusFilter === "all"
        ? `/api/employers/${employer.id}/workers`
        : `/api/employers/${employer.id}/workers?employmentStatusId=${employmentStatusFilter}`;
      const response = await fetch(url, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch workers");
      return response.json();
    },
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Workers</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-muted-foreground" />
            <CardTitle>Workers</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Filter by status:</span>
            <Select value={employmentStatusFilter} onValueChange={setEmploymentStatusFilter}>
              <SelectTrigger className="w-[200px]" data-testid="select-employment-status-filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                {employmentStatuses?.map((status) => (
                  <SelectItem key={status.id} value={status.id}>
                    {status.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {!workers || workers.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Users className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p>No workers found for this employer</p>
            {employmentStatusFilter !== "all" && (
              <p className="text-sm mt-2">Try changing the employment status filter</p>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Worker</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Employment Status</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Position</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Date</th>
                </tr>
              </thead>
              <tbody>
                {workers.map((worker) => (
                  <tr 
                    key={worker.workerId} 
                    className="border-b border-border hover:bg-muted/50 transition-colors"
                    data-testid={`row-worker-${worker.workerId}`}
                  >
                    <td className="py-3 px-4">
                      <Link href={`/workers/${worker.workerId}`} className="text-sm font-medium text-primary hover:underline" data-testid={`link-worker-${worker.workerId}`}>
                        {worker.contactName || "Unnamed Worker"}
                      </Link>
                      <div className="text-xs text-muted-foreground">ID: {worker.workerSiriusId}</div>
                    </td>
                    <td className="py-3 px-4">
                      {worker.employmentStatusName ? (
                        <Badge variant="secondary" data-testid={`badge-status-${worker.workerId}`}>
                          {worker.employmentStatusName}
                        </Badge>
                      ) : (
                        <span className="text-sm text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <span className="text-sm text-foreground">
                        {worker.position || "—"}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span className="text-sm text-foreground">
                        {worker.date ? new Date(worker.date).toLocaleDateString() : "—"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {workers && workers.length > 0 && (
          <div className="mt-4 text-sm text-muted-foreground">
            Showing {workers.length} worker{workers.length !== 1 ? 's' : ''}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function EmployerWorkersPage() {
  return (
    <EmployerLayout activeTab="workers">
      <EmployerWorkersContent />
    </EmployerLayout>
  );
}
