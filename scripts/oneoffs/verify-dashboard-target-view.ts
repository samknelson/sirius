/**
 * One-off e2e check (Task #1013): staff target-view of another user's
 * dashboard. Verifies against the REAL dev DB + real routes:
 *
 *   1. Non-staff callers passing `?targetUserId=` are rejected (403) on both
 *      the items and content endpoints.
 *   2. Staff callers get the TARGET's items: a config role held only by the
 *      target appears in target view, not in the staff's own view.
 *   3. Content resolves with the TARGET's identity (ctx.userId/dbUser).
 *   4. No-target requests are unchanged (staff's own roles/identity).
 *   5. Unknown target id → 404.
 *
 * Run:
 *   npx tsx scripts/oneoffs/verify-dashboard-target-view.ts
 */
import express from "express";
import { storage } from "../../server/storage";
import { loadComponentCache, isComponentEnabledSync } from "../../server/services/component-cache";
import { initAccessControl } from "../../server/services/access-policy-evaluator";
import { initializePermissions } from "../../shared/permissions";
import "../../shared/access-policies/loader";
import { registerDashboardRoutes } from "../../server/modules/dashboard";
import { registerDashboardPlugin, dashboardPluginRegistry } from "../../server/plugins/dashboard/registry";

const PLUGIN_ID = "t1013-target-view-probe";
const PERM_PLUGIN_ID = "t1013-perm-gated-probe";

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

  // ---- pick users ----------------------------------------------------------
  const allUsers = await storage.users.getAllUsers();
  let staffUser: any = null;
  let nonStaffUser: any = null;
  for (const u of allUsers) {
    const isStaff =
      (await storage.users.userHasPermission(u.id, "staff")) ||
      (await storage.users.userHasPermission(u.id, "admin"));
    if (isStaff && !staffUser) staffUser = u;
    if (!isStaff && !nonStaffUser) nonStaffUser = u;
    if (staffUser && nonStaffUser) break;
  }
  if (!staffUser || !nonStaffUser) {
    console.error("FAIL: need one staff and one non-staff user in dev DB");
    process.exit(1);
  }
  // Target = the non-staff user (so target view differs from staff view).
  const target = nonStaffUser;

  // ---- register a probe dashboard plugin -----------------------------------
  registerDashboardPlugin({
    id: PLUGIN_ID,
    name: "T1013 probe",
    description: "target-view verification probe",
    content: async (ctx) => ({ resolvedUserId: ctx.userId, dbUserId: ctx.dbUser.id }),
    client: { component: "generic:Probe", order: 999 },
  });
  // Permission-gated probe: role-visible to the target, but requires a
  // permission the target (non-staff) does not hold. Must be hidden from
  // target-view items AND denied on direct /content?targetUserId= reads.
  registerDashboardPlugin({
    id: PERM_PLUGIN_ID,
    name: "T1013 perm probe",
    description: "target-view permission gating probe",
    content: async (ctx) => ({ resolvedUserId: ctx.userId }),
    client: { component: "generic:Probe", order: 999, requiredPermissions: ["admin"] },
  });

  const app = express();
  app.use(express.json());
  let actor: any = staffUser;
  app.use((req: any, _res, next) => {
    req.user = { claims: { sub: actor.id }, dbUser: actor };
    req.session = req.session || {};
    req.isAuthenticated = () => true;
    next();
  });
  const passthrough = (_req: any, _res: any, next: any) => next();
  registerDashboardRoutes(app, passthrough, () => passthrough);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as any).port}`;

  let failures = 0;
  const check = (label: string, ok: boolean, detail?: unknown) => {
    if (!ok) failures++;
    console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail !== undefined ? " :: " + JSON.stringify(detail) : ""}`);
  };

  const cleanup: Array<() => Promise<unknown>> = [];
  try {
    // Give the TARGET a role the STAFF user does not hold, and scope the
    // probe config to that role.
    const roles = await storage.users.getAllRoles();
    const staffRoleIds = new Set((await storage.users.getUserRoles(staffUser.id)).map((r) => r.id));
    const targetRoleIds = new Set((await storage.users.getUserRoles(target.id)).map((r) => r.id));
    let probeRole = roles.find((r) => !staffRoleIds.has(r.id));
    if (!probeRole) {
      console.error("FAIL: staff user holds every role; cannot isolate a target-only role");
      process.exit(1);
    }
    if (!targetRoleIds.has(probeRole.id)) {
      await storage.users.assignRoleToUser({ userId: target.id, roleId: probeRole.id } as any);
      cleanup.push(() => storage.users.unassignRoleFromUser(target.id, probeRole.id));
    }

    const cfg = await storage.pluginConfigs.create({
      pluginKind: "dashboard",
      pluginId: PLUGIN_ID,
      enabled: true,
      name: "T1013 probe config",
      ordering: 0,
      data: {},
    } as any);
    cleanup.push(() => storage.pluginConfigs.delete(cfg.id));
    await storage.pluginConfigs.upsertSubsidiary("dashboard", { id: cfg.id, roles: [probeRole.id] });

    // 1. Non-staff with a target → 403 on items and content
    actor = nonStaffUser;
    let res = await fetch(`${base}/api/dashboard-plugins/items?targetUserId=${staffUser.id}`);
    check("non-staff items with target rejected 403", res.status === 403, res.status);
    res = await fetch(
      `${base}/api/dashboard-plugins/${PLUGIN_ID}/content?targetUserId=${staffUser.id}&configId=${cfg.id}`,
    );
    check("non-staff content with target rejected 403", res.status === 403, res.status);

    // 4. Non-staff no-target self view unchanged: target holds probe role → sees probe item
    res = await fetch(`${base}/api/dashboard-plugins/items`);
    let items: any[] = await res.json();
    check(
      "no-target items reflect caller's own roles (target sees probe)",
      res.status === 200 && items.some((i) => i.configId === cfg.id),
      items.map((i) => i.configId),
    );
    res = await fetch(`${base}/api/dashboard-plugins/${PLUGIN_ID}/content?configId=${cfg.id}`);
    let body: any = await res.json();
    check(
      "no-target content resolves caller identity",
      res.status === 200 && body.resolvedUserId === target.id,
      body,
    );

    // 2/3. Staff target view
    actor = staffUser;
    res = await fetch(`${base}/api/dashboard-plugins/items`);
    items = await res.json();
    check(
      "staff self view excludes target-only probe item",
      res.status === 200 && !items.some((i) => i.configId === cfg.id),
    );
    res = await fetch(`${base}/api/dashboard-plugins/items?targetUserId=${target.id}`);
    items = await res.json();
    const probeItem = items.find((i) => i.configId === cfg.id);
    check(
      "staff target view includes target's probe item",
      res.status === 200 && !!probeItem,
      items.map((i) => i.configId),
    );
    check(
      "target-view item gating fields stripped",
      !!probeItem && probeItem.requiredPermissions.length === 0 && !probeItem.requiredPolicy,
      probeItem,
    );

    res = await fetch(
      `${base}/api/dashboard-plugins/${PLUGIN_ID}/content?targetUserId=${target.id}&configId=${cfg.id}`,
    );
    body = await res.json();
    check(
      "staff target content resolves TARGET identity",
      res.status === 200 && body.resolvedUserId === target.id && body.dbUserId === target.id,
      body,
    );

    // Staff WITHOUT target must be denied probe content (lacks probe role)
    res = await fetch(`${base}/api/dashboard-plugins/${PLUGIN_ID}/content?configId=${cfg.id}`);
    check("staff no-target probe content denied by role check", res.status === 403, res.status);

    // Client requiredPermissions gating: role-visible but permission-denied
    // widget must be absent from target items and 403 on direct content read.
    const permCfg = await storage.pluginConfigs.create({
      pluginKind: "dashboard",
      pluginId: PERM_PLUGIN_ID,
      enabled: true,
      name: "T1013 perm probe config",
      ordering: 0,
      data: {},
    } as any);
    cleanup.push(() => storage.pluginConfigs.delete(permCfg.id));
    await storage.pluginConfigs.upsertSubsidiary("dashboard", {
      id: permCfg.id,
      roles: [probeRole.id],
    });
    res = await fetch(`${base}/api/dashboard-plugins/items?targetUserId=${target.id}`);
    items = await res.json();
    check(
      "target view hides role-visible but permission-denied widget",
      res.status === 200 && !items.some((i) => i.configId === permCfg.id),
      items.map((i) => i.configId),
    );
    res = await fetch(
      `${base}/api/dashboard-plugins/${PERM_PLUGIN_ID}/content?targetUserId=${target.id}&configId=${permCfg.id}`,
    );
    check(
      "target content denied when target lacks client requiredPermissions",
      res.status === 403,
      res.status,
    );

    // Banner identity endpoint: staff-only, narrow fields
    res = await fetch(`${base}/api/dashboard-plugins/target-user/${target.id}`);
    body = await res.json();
    check(
      "staff target-user summary returns narrow identity fields",
      res.status === 200 &&
        body.id === target.id &&
        Object.keys(body).sort().join(",") === "email,firstName,id,lastName",
      body,
    );
    actor = nonStaffUser;
    res = await fetch(`${base}/api/dashboard-plugins/target-user/${staffUser.id}`);
    check("non-staff target-user summary rejected 403", res.status === 403, res.status);
    actor = staffUser;
    res = await fetch(
      `${base}/api/dashboard-plugins/target-user/00000000-0000-0000-0000-000000000000`,
    );
    check("target-user summary unknown id → 404", res.status === 404, res.status);

    // 5. Unknown target
    res = await fetch(
      `${base}/api/dashboard-plugins/items?targetUserId=00000000-0000-0000-0000-000000000000`,
    );
    check("unknown target id → 404", res.status === 404, res.status);
  } finally {
    for (const fn of cleanup.reverse()) {
      try {
        await fn();
      } catch (e) {
        console.error("cleanup failed:", e);
      }
    }
    server.close();
  }

  console.log(failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
