import { registerCatalog } from "@shared/catalog";
import { getSystemServiceRoleEntries } from "@shared/system-service-roles";

export const SYSTEM_SERVICE_ROLES_CATALOG = "system-service-roles";

/**
 * Registers the same code-supplied declaration that startup reads. It is
 * deliberately registered only with the user API, where catalog reads live.
 */
export function registerSystemServiceRolesCatalog(): void {
  registerCatalog({
    id: SYSTEM_SERVICE_ROLES_CATALOG,
    label: "System Service Roles",
    description:
      "The traffic classes this application can serve. Select them with the comma-separated " +
      "SERVICE_ROLE environment variable; for example, SERVICE_ROLE=static,api-user serves " +
      "all requests except web services. This lists code capabilities, not the roles selected " +
      "for a particular container.",
    audience: "signed-in",
    entries: getSystemServiceRoleEntries,
  });
}