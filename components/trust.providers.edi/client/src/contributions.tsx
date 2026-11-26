import { lazy } from "react";
import type { ComponentBrowserContributions } from "../../../../client/src/lib/component-contributions";
const ProtectedRoute = lazy(() => import("@/components/auth/ProtectedRoute"));
const AuthenticatedLayout = lazy(() => import("@/components/layouts/AuthenticatedLayout"));
const Dashboard = lazy(() => import("./pages/trust/provider-edi-dashboard"));
function EdiDashboard() {
  return <ProtectedRoute permission="admin" component="trust.providers.edi">
    <AuthenticatedLayout><Dashboard /></AuthenticatedLayout>
  </ProtectedRoute>;
}
export const contributions: ComponentBrowserContributions = {
  routes: [{ path: "/trust/provider-edi", layout: "bare", page: EdiDashboard }],
  pluginViews: {
    dashboard: { "edi-summary:EdiSummary": lazy(() => import("./plugins/dashboard/edi-summary/EdiSummary").then(m => ({ default: m.EdiSummary }))) },
    wizardSteps: {
      "trust_provider_edi:ConfigPicker": lazy(() => import("./plugins/wizards/trust_provider_edi/ConfigPicker").then(m => ({ default: m.ConfigPicker }))),
      "trust_provider_edi:DeliverStep": lazy(() => import("./plugins/wizards/trust_provider_edi/DeliverStep").then(m => ({ default: m.DeliverStep }))),
      "trust_provider_edi:ResultsTable": lazy(() => import("./plugins/wizards/trust_provider_edi/ResultsTable").then(m => ({ default: m.ResultsTable }))),
      "trust_provider_edi:RunView": lazy(() => import("./plugins/wizards/trust_provider_edi/RunView").then(m => ({ default: m.RunView }))),
    },
  },
};
