import ProtectedRoute from "@/components/auth/ProtectedRoute";
import AuthenticatedLayout from "@/components/layouts/AuthenticatedLayout";
import ConfigurationLayout from "@/components/layouts/ConfigurationLayout";
import GrievancesAddPage from "./pages/grievances-add";
import GrievancesPage from "./pages/grievances";
import GrievanceEditPage from "./pages/grievance-edit";
import GrievanceStatusHistoryPage from "./pages/grievance-status-history";
import GrievanceLogsPage from "./pages/grievance-logs";
import GrievanceNotesPage from "./pages/grievance-notes";
import GrievanceTimelinePage from "./pages/grievance-timeline";
import GrievanceFilesPage from "./pages/grievance-files";
import GrievanceViewPage from "./pages/grievance-view";
import GrievanceTimelineTemplatesPage from "./pages/config/grievance-timeline-templates";
import GrievanceTimelineTemplateEditPage from "./pages/grievance-timeline-template-edit";
import GrievanceTimelineTemplateItemsPage from "./pages/grievance-timeline-template-items";
import GrievanceTimelineTemplateLogsPage from "./pages/grievance-timeline-template-logs";
import GrievanceTimelineTemplateViewPage from "./pages/grievance-timeline-template-view";
import WorkerGrievancesPage from "./pages/worker-grievances";
import EmployerGrievancesPage from "./pages/employer-grievances";

export function GrievancesAddRoute() {
  return <ProtectedRoute permission="staff" component="grievance">
    <AuthenticatedLayout><GrievancesAddPage /></AuthenticatedLayout>
  </ProtectedRoute>;
}
export function GrievancesRoute() {
  return <ProtectedRoute permission="staff" component="grievance">
    <AuthenticatedLayout><GrievancesPage /></AuthenticatedLayout>
  </ProtectedRoute>;
}
export function GrievanceEditRoute() {
  return <ProtectedRoute tabId="edit" entityType="grievance">
    <AuthenticatedLayout><GrievanceEditPage /></AuthenticatedLayout>
  </ProtectedRoute>;
}
export function GrievanceStatusHistoryRoute() {
  return <ProtectedRoute tabId="status-history" entityType="grievance">
    <AuthenticatedLayout><GrievanceStatusHistoryPage /></AuthenticatedLayout>
  </ProtectedRoute>;
}
export function GrievanceLogsRoute() {
  return <ProtectedRoute tabId="logs" entityType="grievance">
    <AuthenticatedLayout><GrievanceLogsPage /></AuthenticatedLayout>
  </ProtectedRoute>;
}
export function GrievanceNotesRoute() {
  return <ProtectedRoute tabId="notes" entityType="grievance">
    <AuthenticatedLayout><GrievanceNotesPage /></AuthenticatedLayout>
  </ProtectedRoute>;
}
export function GrievanceTimelineRoute() {
  return <ProtectedRoute tabId="timeline" entityType="grievance">
    <AuthenticatedLayout><GrievanceTimelinePage /></AuthenticatedLayout>
  </ProtectedRoute>;
}
export function GrievanceFilesRoute() {
  return <ProtectedRoute tabId="files" entityType="grievance">
    <AuthenticatedLayout><GrievanceFilesPage /></AuthenticatedLayout>
  </ProtectedRoute>;
}
export function GrievanceViewRoute() {
  return <ProtectedRoute tabId="details" entityType="grievance">
    <AuthenticatedLayout><GrievanceViewPage /></AuthenticatedLayout>
  </ProtectedRoute>;
}
export function GrievanceTimelineTemplatesRoute() {
  return <ProtectedRoute permission="admin" component="grievance">
    <AuthenticatedLayout><ConfigurationLayout><GrievanceTimelineTemplatesPage /></ConfigurationLayout></AuthenticatedLayout>
  </ProtectedRoute>;
}
export function GrievanceTimelineTemplateEditRoute() {
  return <ProtectedRoute tabId="edit" entityType="grievanceTimelineTemplate">
    <AuthenticatedLayout><GrievanceTimelineTemplateEditPage /></AuthenticatedLayout>
  </ProtectedRoute>;
}
export function GrievanceTimelineTemplateItemsRoute() {
  return <ProtectedRoute tabId="items" entityType="grievanceTimelineTemplate">
    <AuthenticatedLayout><GrievanceTimelineTemplateItemsPage /></AuthenticatedLayout>
  </ProtectedRoute>;
}
export function GrievanceTimelineTemplateLogsRoute() {
  return <ProtectedRoute tabId="logs" entityType="grievanceTimelineTemplate">
    <AuthenticatedLayout><GrievanceTimelineTemplateLogsPage /></AuthenticatedLayout>
  </ProtectedRoute>;
}
export function GrievanceTimelineTemplateViewRoute() {
  return <ProtectedRoute tabId="details" entityType="grievanceTimelineTemplate">
    <AuthenticatedLayout><GrievanceTimelineTemplateViewPage /></AuthenticatedLayout>
  </ProtectedRoute>;
}
export function WorkerGrievancesRoute() {
  return <ProtectedRoute tabId="grievances" entityType="worker">
    <AuthenticatedLayout><WorkerGrievancesPage /></AuthenticatedLayout>
  </ProtectedRoute>;
}
export function EmployerGrievancesRoute() {
  return <ProtectedRoute tabId="grievances" entityType="employer">
    <AuthenticatedLayout><EmployerGrievancesPage /></AuthenticatedLayout>
  </ProtectedRoute>;
}
