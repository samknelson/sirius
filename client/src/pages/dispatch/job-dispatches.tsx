import { useQuery } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { DispatchJobLayout, useDispatchJobLayout } from "@/components/layouts/DispatchJobLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { DispatchListTable } from "@/components/dispatch/DispatchListTable";
import type { DispatchWithRelations } from "../../../../server/storage/dispatches";

function JobDispatchesContent() {
  const { job } = useDispatchJobLayout();

  const { data: dispatches, isLoading } = useQuery<DispatchWithRelations[]>({
    queryKey: [`/api/dispatches/job/${job.id}`],
  });

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
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5" />
          Dispatches
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!dispatches || dispatches.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12" data-testid="empty-state-no-dispatches">
            <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
              <Users className="text-muted-foreground" size={32} />
            </div>
            <h3 className="text-lg font-medium text-foreground mb-2" data-testid="text-empty-title">No Dispatches Yet</h3>
            <p className="text-muted-foreground text-center mb-4" data-testid="text-empty-message">
              No workers have been dispatched to this job yet.
            </p>
          </div>
        ) : (
          <DispatchListTable dispatches={dispatches} showWorker />
        )}
      </CardContent>
    </Card>
  );
}

export default function JobDispatchesPage() {
  return (
    <DispatchJobLayout activeTab="dispatches-list">
      <JobDispatchesContent />
    </DispatchJobLayout>
  );
}
