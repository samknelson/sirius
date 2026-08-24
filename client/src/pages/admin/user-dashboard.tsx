import { useParams, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AlertCircle, ArrowLeft } from "lucide-react";
import {
  TargetDashboardView,
  type TargetUserSummary,
} from "@/components/dashboard/target-dashboard-view";

/**
 * Staff target-view of another user's dashboard (`/users/:id/dashboard`).
 * Renders the shared Dashboard page in target mode: items, gating, and every
 * widget content read resolve server-side against the TARGET user, so staff
 * see exactly what that user sees — without masquerading. Widget actions stay
 * fully functional (staff are authorized to act on the worker's data).
 *
 * The banner's identity read uses the narrow, staff-authorized
 * `/api/dashboard-plugins/target-user/:id` endpoint (NOT the admin-only user
 * detail API), so non-admin staff can use this page.
 */
export default function UserDashboardPage() {
  const { id } = useParams<{ id: string }>();

  const {
    data: targetUser,
    isLoading,
    error,
  } = useQuery<TargetUserSummary>({
    queryKey: [`/api/dashboard-plugins/target-user/${id}`],
    enabled: !!id,
  });

  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 text-center text-muted-foreground">
        <p>Loading user...</p>
      </div>
    );
  }

  if (error || !targetUser) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Alert variant="destructive" data-testid="alert-target-dashboard-error">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Cannot view this user's dashboard</AlertTitle>
          <AlertDescription>
            The user was not found or you do not have access.
          </AlertDescription>
        </Alert>
        <div className="mt-4">
          <Link href="/admin/users/list">
            <Button variant="ghost" size="sm" data-testid="button-back-to-users">
              <ArrowLeft size={16} className="mr-2" />
              Back to Users
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return <TargetDashboardView targetUser={targetUser} />;
}
