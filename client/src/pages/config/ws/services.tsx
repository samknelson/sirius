import GenericPluginConfigsPage from "@/pages/admin/plugin-configs";
import { usePageTitle } from "@/contexts/PageTitleContext";

/**
 * "Services" page under Web Services. Each row is one configuration of a
 * web-service plugin — an independently enable-able, individually addressable
 * service. Reuses the generic plugin-config page (the same one behind
 * /admin/plugin-configs/web-service) in embedded mode, so there is no bespoke
 * create/edit UI to keep in sync with the kind's schema.
 */
export default function WsServicesPage() {
  usePageTitle("Web Services");
  return <GenericPluginConfigsPage kind="web-service" embedded />;
}
