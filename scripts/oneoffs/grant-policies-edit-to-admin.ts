/**
 * One-off: grant the `policies.edit` permission to the `admin` role.
 *
 * `policies.edit` is a newly-registered core permission (see
 * `shared/permissions.ts`). The admin role only receives the full permission
 * set at bootstrap time, so an already-bootstrapped database does NOT pick up
 * a permission added afterwards. This script backfills that single grant on an
 * existing database, going through the storage layer so the change is audited.
 *
 * It is idempotent: if the admin role already has `policies.edit`, it is a
 * no-op.
 *
 * Usage:
 *   npx tsx scripts/oneoffs/grant-policies-edit-to-admin.ts
 */

import { storage } from "../../server/storage";
import { initializePermissions } from "../../shared/permissions";

const PERMISSION_KEY = "policies.edit";
const ROLE_NAME = "admin";

async function main(): Promise<void> {
  // assignPermissionToRole validates against the in-memory registry, which is
  // populated by app startup. In a standalone script we must initialize it.
  initializePermissions();

  const adminRole = await storage.users.getRoleByName(ROLE_NAME);
  if (!adminRole) {
    console.log(`No "${ROLE_NAME}" role found — nothing to do.`);
    return;
  }

  const rolesWithPerm = await storage.users.getRolesWithPermission(PERMISSION_KEY);
  if (rolesWithPerm.some((r) => r.id === adminRole.id)) {
    console.log(`"${ROLE_NAME}" role already has "${PERMISSION_KEY}" — no change.`);
    return;
  }

  await storage.users.assignPermissionToRole({
    roleId: adminRole.id,
    permissionKey: PERMISSION_KEY,
  });
  console.log(`Granted "${PERMISSION_KEY}" to "${ROLE_NAME}" role.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Failed to grant permission:", err);
    process.exit(1);
  });
