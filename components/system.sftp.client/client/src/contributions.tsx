import { lazy } from "react";
import { Server } from "lucide-react";
import type { ComponentBrowserContributions } from "../../../../client/src/lib/component-contributions";
import { componentConfigRoute } from "../../../../client/src/lib/component-routes";
const ProtectedRoute = lazy(() => import("@/components/auth/ProtectedRoute"));
const AuthenticatedLayout = lazy(() => import("@/components/layouts/AuthenticatedLayout"));
const Clients = lazy(() => import("./pages/config/sftp/clients"));
const Details = lazy(() => import("./pages/config/sftp/client-details"));
const Connection = lazy(() => import("./pages/config/sftp/client-connection"));
const Test = lazy(() => import("./pages/config/sftp/client-test"));
const Logs = lazy(() => import("./pages/config/sftp/client-logs"));
const Edit = lazy(() => import("./pages/config/sftp/client-edit"));
function adminPage(Page: typeof Details) {
  return function DestinationPage() {
    return <ProtectedRoute permission="admin" component="system.sftp.client">
      <AuthenticatedLayout><Page /></AuthenticatedLayout>
    </ProtectedRoute>;
  };
}
export const contributions: ComponentBrowserContributions = {
  navigation: [{ section: "webservices", item: {
    path: "/config/sftp/clients", label: "SFTP Clients", icon: Server,
    testId: "nav-config-sftp-clients", permission: "admin", requiresComponent: "system.sftp.client",
  } }],
  routes: [
    { path: "/config/sftp/client/:id/connection", layout: "bare", page: adminPage(Connection) },
    { path: "/config/sftp/client/:id/test", layout: "bare", page: adminPage(Test) },
    { path: "/config/sftp/client/:id/logs", layout: "bare", page: adminPage(Logs) },
    { path: "/config/sftp/client/:id/edit", layout: "bare", page: adminPage(Edit) },
    { path: "/config/sftp/client/:id", layout: "bare", page: adminPage(Details) },
    { path: "/config/sftp/clients", layout: "bare", page: componentConfigRoute(Clients, "system.sftp.client") },
  ],
};
