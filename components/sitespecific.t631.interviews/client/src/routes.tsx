import { useParams } from "wouter";
import ProtectedRoute from "@/components/auth/ProtectedRoute";
import AuthenticatedLayout from "@/components/layouts/AuthenticatedLayout";
import WorkerInterviews from "./pages/workers/dispatch-t631-interviews";
import JobInterviews from "./pages/dispatch/job-t631-interviews";
import JobOffers from "./pages/dispatch/job-t631-interview-offers";
export function WorkerInterviewsRoute() {
  return <ProtectedRoute tabId="dispatch-t631-interviews" entityType="worker">
    <AuthenticatedLayout><WorkerInterviews /></AuthenticatedLayout>
  </ProtectedRoute>;
}
export function JobInterviewsRoute() {
  const { id } = useParams<{ id: string }>();
  return <ProtectedRoute tabId="sitespecific-t631-interviews" entityType="dispatch_job" entityId={id}>
    <AuthenticatedLayout><JobInterviews /></AuthenticatedLayout>
  </ProtectedRoute>;
}
export function JobOffersRoute() {
  const { id } = useParams<{ id: string }>();
  return <ProtectedRoute tabId="sitespecific-t631-interviews-offers" entityType="dispatch_job" entityId={id}>
    <AuthenticatedLayout><JobOffers /></AuthenticatedLayout>
  </ProtectedRoute>;
}
