import { useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle, UserX } from "lucide-react";
import { WorkerLayout } from "@/components/layouts/WorkerLayout";
import {
  TargetDashboardView,
  type TargetUserSummary,
} from "@/components/dashboard/target-dashboard-view";

interface WorkerDashboardUserResponse {
  hasUser: boolean;
  user: TargetUserSummary | null;
}

/**
 * Worker "Dashboard" tab (`/workers/:id/dashboard`, Identity group, staff-only).
 * Resolves the worker's linked user via the narrow staff-gated
 * `/api/workers/:id/dashboard-user` endpoint and renders the SAME shared
 * target-dashboard view as `/users/:id/dashboard`. All dashboard target
 * authorization stays server-side in the dashboard endpoints.
 */
export default function WorkerDashboardPage() {
  const { id } = useParams<{ id: string }>();

  const { data, isLoading, error } = useQuery<WorkerDashboardUserResponse>({
    queryKey: [`/api/workers/${id}/dashboard-user`],
    enabled: !!id,
  });

  return (
    <WorkerLayout activeTab="dashboard">
      {isLoading ? (
        <div className="text-center text-muted-foreground py-8">
          <p>Loading user...</p>
        </div>
      ) : error ? (
        <Alert variant="destructive" data-testid="alert-worker-dashboard-error">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Cannot view this worker's dashboard</AlertTitle>
          <AlertDescription>
            The linked user could not be resolved or you do not have access.
          </AlertDescription>
        </Alert>
      ) : !data?.hasUser || !data.user ? (
        <Alert data-testid="alert-worker-dashboard-no-user">
          <UserX className="h-4 w-4" />
          <AlertTitle>No linked user account</AlertTitle>
          <AlertDescription>
            This worker does not have an associated user account, so there is no
            dashboard to show.
          </AlertDescription>
        </Alert>
      ) : (
        <TargetDashboardView targetUser={data.user} />
      )}
    </WorkerLayout>
  );
}
