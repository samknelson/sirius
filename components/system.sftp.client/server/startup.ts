import type { ComponentStartup } from "../../../server/services/component/startup-types";
import { storage } from "../../../server/storage";
import { registerSftpClientDestinationRoutes } from "./modules/sftp-client-destinations";
import { alterHooks } from "../../../shared/alter";
import { tabEntityPolicyHook } from "../../../shared/tab-visibility";
import { registerPrivateHttpScope } from "../../../server/services/http-response-privacy";
export function register() {
  registerPrivateHttpScope("/api/sftp/client-destinations");
  alterHooks.register(tabEntityPolicyHook, {
    id: "system.sftp.client.tabs.entity-policy",
    component: "system.sftp.client",
    description: "Keep destination tab batches admin-only.",
    priority: 0,
    metadata: {},
    alter: (policy, { entityType }) => entityType === "sftp_client_destination" ? "admin" : policy,
  });
}
export const registerRoutes: NonNullable<ComponentStartup["registerRoutes"]> =
  (app, auth, _permission, access) => registerSftpClientDestinationRoutes(app, auth, access, storage);
