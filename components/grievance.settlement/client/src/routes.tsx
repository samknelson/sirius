import ProtectedRoute from "@/components/auth/ProtectedRoute";
import AuthenticatedLayout from "@/components/layouts/AuthenticatedLayout";
import GrievanceSettlements from "./pages/grievance-settlements";

export function GrievanceSettlementsRoute() {
  return <ProtectedRoute tabId="settlements" entityType="grievance">
    <AuthenticatedLayout><GrievanceSettlements /></AuthenticatedLayout>
  </ProtectedRoute>;
}
