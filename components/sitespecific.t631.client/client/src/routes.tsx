import { useAuth } from "@/contexts/AuthContext";
import ProtectedRoute from "@/components/auth/ProtectedRoute";
import AuthenticatedLayout from "@/components/layouts/AuthenticatedLayout";
import ConfigurationLayout from "@/components/layouts/ConfigurationLayout";
import { Skeleton } from "@/components/ui/skeleton";
import ArrivalPage from "./pages/sitespecific/t631-arrive";
import MemberStatusPage from "./pages/config/edls/t631-ms";

export function ArrivalRoute() {
  const { isAuthenticated, authReady } = useAuth();
  if (!authReady) return (
    <div className="flex items-center justify-center min-h-[400px]"><div className="space-y-4 w-full max-w-md">
      <Skeleton className="h-8 w-3/4" /><Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-5/6" /><Skeleton className="h-32 w-full" />
    </div></div>
  );
  return isAuthenticated ? <AuthenticatedLayout><ArrivalPage /></AuthenticatedLayout> : <ArrivalPage />;
}
export function MemberStatusRoute() {
  return <ProtectedRoute permission="admin" componentAll={["edls", "sitespecific.t631.client"]}>
    <AuthenticatedLayout><ConfigurationLayout><MemberStatusPage /></ConfigurationLayout></AuthenticatedLayout>
  </ProtectedRoute>;
}
