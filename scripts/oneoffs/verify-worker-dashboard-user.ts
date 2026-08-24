/**
 * One-off e2e check (Task #1015): worker Dashboard tab linkage endpoint.
 * Verifies GET /api/workers/:id/dashboard-user against the REAL dev DB:
 *
 *   1. Non-staff callers are rejected (403).
 *   2. Staff caller on a worker WITH a linked user → { hasUser: true, user }
 *      with ONLY the narrow id/email/firstName/lastName fields.
 *   3. Staff caller on a worker WITHOUT a linked user → { hasUser: false }.
 *   4. Unknown worker id → 404.
 *
 * Run:
 *   npx tsx scripts/oneoffs/verify-worker-dashboard-user.ts
 */
import express from "express";
import { storage } from "../../server/storage";
import { loadComponentCache, isComponentEnabledSync } from "../../server/services/component-cache";
import { initAccessControl } from "../../server/services/access-policy-evaluator";
import { initializePermissions } from "../../shared/permissions";
import "../../shared/access-policies/loader";
import { registerWorkerUsersRoutes } from "../../server/modules/workers/users";

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

  // ---- pick workers: one with a linked user, one without -------------------
  const workers = (await storage.workers.getAllWorkers()).slice(0, 500);
  let linkedWorker: any = null;
  let linkedUser: any = null;
  let unlinkedWorker: any = null;
  for (const w of workers) {
    const contact = await storage.contacts.getContact(w.contactId);
    const user = contact?.email ? await storage.users.getUserByEmail(contact.email) : undefined;
    if (user && !linkedWorker) {
      linkedWorker = w;
      linkedUser = user;
    }
    if (!user && !unlinkedWorker) unlinkedWorker = w;
    if (linkedWorker && unlinkedWorker) break;
  }
  if (!linkedWorker || !unlinkedWorker) {
    console.error("FAIL: need one worker with and one without a linked user in dev DB", {
      linkedWorker: linkedWorker?.id,
      unlinkedWorker: unlinkedWorker?.id,
    });
    process.exit(1);
  }

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
  registerWorkerUsersRoutes(app, passthrough, () => passthrough);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as any).port}`;

  let failures = 0;
  const check = (label: string, ok: boolean, detail?: unknown) => {
    if (!ok) failures++;
    console.log(
      `${ok ? "PASS" : "FAIL"} ${label}${detail !== undefined ? " :: " + JSON.stringify(detail) : ""}`,
    );
  };

  try {
    // 1. Non-staff rejected
    actor = nonStaffUser;
    let res = await fetch(`${base}/api/workers/${linkedWorker.id}/dashboard-user`);
    check("non-staff rejected 403", res.status === 403, res.status);

    // 2. Staff, worker with linked user
    actor = staffUser;
    res = await fetch(`${base}/api/workers/${linkedWorker.id}/dashboard-user`);
    let body: any = await res.json();
    check(
      "staff + linked worker → hasUser:true with correct user id",
      res.status === 200 && body.hasUser === true && body.user?.id === linkedUser.id,
      body,
    );
    check(
      "linked user payload is narrow (email,firstName,id,lastName only)",
      !!body.user && Object.keys(body.user).sort().join(",") === "email,firstName,id,lastName",
      body.user,
    );

    // 3. Staff, worker without linked user
    res = await fetch(`${base}/api/workers/${unlinkedWorker.id}/dashboard-user`);
    body = await res.json();
    check(
      "staff + unlinked worker → hasUser:false",
      res.status === 200 && body.hasUser === false && body.user === null,
      body,
    );

    // 4. Unknown worker
    res = await fetch(`${base}/api/workers/00000000-0000-0000-0000-000000000000/dashboard-user`);
    check("unknown worker id → 404", res.status === 404, res.status);
  } finally {
    server.close();
  }

  console.log(failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
