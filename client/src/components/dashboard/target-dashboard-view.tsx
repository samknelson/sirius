import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Eye } from "lucide-react";
import Dashboard from "@/pages/dashboard";

export interface TargetUserSummary {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
}

/**
 * Shared staff target-view of another user's dashboard: the "Viewing dashboard
 * of <user>" banner plus the shared Dashboard page in target mode. Used by both
 * the /users/:id/dashboard page and the worker Dashboard tab, so the target UX
 * lives in exactly one place. All target authorization is server-side.
 */
export function TargetDashboardView({ targetUser }: { targetUser: TargetUserSummary }) {
  const name =
    `${targetUser.firstName || ""} ${targetUser.lastName || ""}`.trim() ||
    targetUser.email ||
    targetUser.id;

  return (
    <div>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-4">
        <Alert data-testid="alert-target-dashboard-banner">
          <Eye className="h-4 w-4" />
          <AlertTitle>Viewing dashboard of {name}</AlertTitle>
          <AlertDescription>
            You are seeing this user's dashboard exactly as they would see it.
            Widget actions act on their data.
          </AlertDescription>
        </Alert>
      </div>
      <Dashboard targetUserId={targetUser.id} />
    </div>
  );
}
