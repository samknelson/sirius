import GenericPluginConfigsPage from "@/pages/admin/plugin-configs";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { WsLayout } from "@/components/layouts/WebServicesLayout";

/**
 * "Services" tab of the incoming web services page. Each row is one
 * configuration of a web-service plugin — an independently enable-able,
 * individually addressable service. Reuses the generic plugin-config page (the
 * same one behind /admin/plugin-configs/web-service) in embedded mode, so there
 * is no bespoke create/edit UI to keep in sync with the kind's schema.
 */
export default function WsServicesPage() {
  usePageTitle("Incoming Web Services");
  return (
    <WsLayout activeTab="ws-services">
      <GenericPluginConfigsPage kind="web-service" embedded />
    </WsLayout>
  );
}
