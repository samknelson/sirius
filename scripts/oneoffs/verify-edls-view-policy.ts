/**
 * One-off check for Task #753: the edls.sheet.view policy must now grant
 * edls.manager (and coordinator / worker.advisor) on any sheet, while an
 * edls.supervisor-only user is still limited to assigned sheets.
 *
 * Run: npx tsx scripts/oneoffs/verify-edls-view-policy.ts
 */
import { storage } from "../../server/storage";
import { loadComponentCache, isComponentEnabledSync } from "../../server/services/component-cache";
import {
  initAccessControl,
  registerEntityLoader,
  evaluatePolicy,
} from "../../server/services/access-policy-evaluator";
import { initializePermissions } from "../../shared/permissions";
import "../../shared/access-policies/loader";

async function main() {
  await loadComponentCache();
  initializePermissions();
  initAccessControl(
    {
      getUserPermissions: async (userId: string) => {
        const permissions = await storage.users.getUserPermissions(userId);
        return permissions.map((p) => p.key);
      },
      hasPermission: async (userId: string, permissionKey: string) =>
        storage.users.userHasPermission(userId, permissionKey),
      getUser: async (userId: string) => storage.users.getUser(userId),
    },
    storage,
    async (componentId: string) => isComponentEnabledSync(componentId),
  );
  registerEntityLoader("edls_sheet", async (id: string, injectedStorage: any) => {
    return (await injectedStorage.edlsSheets?.get?.(id)) || null;
  });

  const accessStorage = {
    getUserPermissions: async (userId: string) => {
      const permissions = await storage.users.getUserPermissions(userId);
      return permissions.map((p) => p.key);
    },
    hasPermission: async (userId: string, permissionKey: string) =>
      storage.users.userHasPermission(userId, permissionKey),
    getUser: async (userId: string) => storage.users.getUser(userId),
  };
  const checkComponent = async (componentId: string) => isComponentEnabledSync(componentId);

  // Known test users (permission sets confirmed via role_permissions):
  // edls_manager@gmail.com -> {edls.manager} only; edls_supervisor@gmail.com -> {edls.supervisor} only.
  const managerUser = await storage.users.getUserByEmail("edls_manager@gmail.com");
  const supervisorOnlyUser = await storage.users.getUserByEmail("edls_supervisor@gmail.com");
  console.log("manager-only user:", managerUser?.email ?? "(none found)");
  console.log("supervisor-only user:", supervisorOnlyUser?.email ?? "(none found)");
  if (!managerUser || !supervisorOnlyUser) {
    console.error("FAIL: expected fixture users are missing; cannot verify");
    process.exit(1);
  }

  const sheets = await storage.edlsSheets.getAll();
  if (sheets.length === 0) {
    console.log("SKIP: no sheets in DB");
    process.exit(1);
  }

  let failures = 0;
  const expect = async (label: string, user: any, sheetId: string, expected: boolean) => {
    const result = await evaluatePolicy(user, "edls.sheet.view", storage, accessStorage as any, checkComponent, sheetId, undefined, { skipCache: true });
    const ok = result.granted === expected;
    if (!ok) failures++;
    console.log(`${ok ? "PASS" : "FAIL"} [${label}] granted=${result.granted} expected=${expected} reason=${result.reason}`);
  };

  if (managerUser) {
    for (const s of sheets.slice(0, 3)) {
      await expect(`manager views sheet ${s.id.slice(0, 8)}`, managerUser, s.id, true);
    }
  }
  if (supervisorOnlyUser) {
    const assigned = sheets.filter(
      (s: any) => s.supervisor === supervisorOnlyUser.id || s.assignee === supervisorOnlyUser.id,
    );
    const unassigned = sheets.filter(
      (s: any) => s.supervisor !== supervisorOnlyUser.id && s.assignee !== supervisorOnlyUser.id,
    );
    if (assigned[0]) await expect("supervisor views assigned sheet", supervisorOnlyUser, assigned[0].id, true);
    if (unassigned[0]) await expect("supervisor denied unassigned sheet", supervisorOnlyUser, unassigned[0].id, false);
  }

  console.log(failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
