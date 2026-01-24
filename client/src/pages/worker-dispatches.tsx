import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "wouter";
import { Truck, Filter } from "lucide-react";
import { WorkerLayout } from "@/components/layouts/WorkerLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DispatchListTable } from "@/components/dispatch/DispatchListTable";
import type { DispatchWithRelations } from "../../../server/storage/dispatches";

const statusOptions = [
  { value: "all", label: "All Statuses" },
  { value: "pending", label: "Pending" },
  { value: "notified", label: "Notified" },
  { value: "accepted", label: "Accepted" },
  { value: "layoff", label: "Layoff" },
  { value: "resigned", label: "Resigned" },
  { value: "declined", label: "Declined" },
];

function WorkerDispatchesContent() {
  const { id: workerId } = useParams<{ id: string }>();
  const [statusFilter, setStatusFilter] = useState("all");

  const { data: dispatches, isLoading } = useQuery<DispatchWithRelations[]>({
    queryKey: [`/api/dispatches/worker/${workerId}`],
    enabled: !!workerId,
  });

  const filteredDispatches = useMemo(() => {
    if (!dispatches) return [];
    if (statusFilter === "all") return dispatches;
    return dispatches.filter(d => d.status === statusFilter);
  }, [dispatches, statusFilter]);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4 flex-wrap">
        <CardTitle className="flex items-center gap-2">
          <Truck className="h-5 w-5" />
          Dispatches
        </CardTitle>
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[180px]" data-testid="select-status-filter">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              {statusOptions.map((option) => (
                <SelectItem key={option.value} value={option.value} data-testid={`option-status-${option.value}`}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        {!filteredDispatches || filteredDispatches.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12" data-testid="empty-state-no-dispatches">
            <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
              <Truck className="text-muted-foreground" size={32} />
            </div>
            <h3 className="text-lg font-medium text-foreground mb-2" data-testid="text-empty-title">
              {statusFilter === "all" ? "No Dispatches Yet" : "No Matching Dispatches"}
            </h3>
            <p className="text-muted-foreground text-center mb-4" data-testid="text-empty-message">
              {statusFilter === "all" 
                ? "This worker has not been dispatched to any jobs yet."
                : `No dispatches with status "${statusFilter}" found.`}
            </p>
          </div>
        ) : (
          <DispatchListTable dispatches={filteredDispatches} showJob />
        )}
      </CardContent>
    </Card>
  );
}

export default function WorkerDispatchesPage() {
  return (
    <WorkerLayout activeTab="dispatches">
      <WorkerDispatchesContent />
    </WorkerLayout>
  );
}
