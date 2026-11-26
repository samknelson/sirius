import { lazy, type ComponentType, type ComponentProps } from "react";
import ProtectedRoute from "@/components/auth/ProtectedRoute";
import AuthenticatedLayout from "@/components/layouts/AuthenticatedLayout";
import ConfigurationLayout from "@/components/layouts/ConfigurationLayout";
import { useParams } from "wouter";

type Guard = Omit<ComponentProps<typeof ProtectedRoute>, "children">;
function guarded(Page: ComponentType<any>, guard: Guard, config = false) {
  return function GuardedPage() {
    const params = useParams<{ id?: string }>();
    // Nested actions end in a tab name, not an ID. The owner supplies route
    // identity rather than extending the generic guard's URL vocabulary.
    const entityId = guard.entityId ?? (guard.entityType ? params.id : undefined);
    return <ProtectedRoute component="edls" {...guard} entityId={entityId}>
      <AuthenticatedLayout>{config ? <ConfigurationLayout><Page /></ConfigurationLayout> : <Page />}</AuthenticatedLayout>
    </ProtectedRoute>;
  };
}
const Sheets = lazy(() => import("./pages/edls/sheets"));
const Workers = lazy(() => import("./pages/edls/workers"));
const Assignments = lazy(() => import("./pages/edls/assignments"));
const Details = lazy(() => import("./pages/edls/sheet-details"));
const Next = lazy(() => import("./pages/edls/sheet-next-assignments"));
const Assign = lazy(() => import("./pages/edls/sheet-assignments"));
const Manage = lazy(() => import("./pages/edls/sheet-manage"));
const Edit = lazy(() => import("./pages/edls/sheet-edit"));
const Logs = lazy(() => import("./pages/edls/sheet-logs"));
const Snapshots = lazy(() => import("./pages/edls/sheet-snapshots"));
const WorkerStatus = lazy(() => import("./pages/worker-edls"));
const WorkerAssignments = lazy(() => import("./pages/worker-edls-assignments"));
const Settings = lazy(() => import("./pages/config/edls/settings"));
const Tasks = lazy(() => import("./pages/config/edls/tasks"));
const Reports = lazy(() => import("@/pages/reports"));

export const SheetsRoute = guarded(Sheets, { policy: "edls.any" });
export const WorkersRoute = guarded(Workers, { policy: "edls.any" });
export const AssignmentsRoute = guarded(Assignments, { policy: "edls.coordinator" });
export const DetailsRoute = guarded(Details, { tabId: "details", entityType: "edls_sheet" });
export const NextRoute = guarded(Next, { tabId: "next-assignments", entityType: "edls_sheet" });
export const AssignRoute = guarded(Assign, { tabId: "assignments", entityType: "edls_sheet" });
export const ManageRoute = guarded(Manage, { tabId: "manage", entityType: "edls_sheet" });
export const EditRoute = guarded(Edit, { tabId: "edit", entityType: "edls_sheet" });
export const LogsRoute = guarded(Logs, { tabId: "logs", entityType: "edls_sheet" });
export const SnapshotsRoute = guarded(Snapshots, { tabId: "snapshots", entityType: "edls_sheet" });
export const WorkerStatusRoute = guarded(WorkerStatus, { tabId: "edls-status", entityType: "worker" });
export const WorkerAssignmentsRoute = guarded(WorkerAssignments, { tabId: "edls-assignments", entityType: "worker" });
export const SettingsRoute = guarded(Settings, { permission: "admin" }, true);
export const TasksRoute = guarded(Tasks, { permission: "admin" }, true);
export const ReportsRoute = guarded(() => <Reports activeCategory="EDLS" />, { policy: "edls.reader" });
