/**
 * Route-harness check for the dispatch job Employer Contacts endpoints:
 *  - staff can list, add, and remove associations
 *  - adding a contact from a DIFFERENT employer → 400 (same-employer rule)
 *  - duplicate association → 409
 *  - association survives the contact being removed from the employer
 *  - employer user linked to the job's employer: allowed (list/candidates/add)
 *  - employer user linked to a DIFFERENT employer: 403
 *  - user with no staff/employer permission: 403
 *  - delete is scoped to the job (association of another job → 404)
 */
import express from "express";
import { db } from "../../server/storage/db";
import { sql } from "drizzle-orm";
import { storage } from "../../server/storage";
import { loadComponentCache, isComponentEnabledSync } from "../../server/services/component-cache";
import { initAccessControl, requireAccess, requireAuth } from "../../server/services/access-policy-evaluator";
import { initializePermissions } from "../../shared/permissions";
import "../../shared/access-policies/loader";
import { registerDispatchJobEmployerContactsRoutes } from "../../server/modules/dispatch/job-employer-contacts";

let failures = 0;
const check = (label: string, ok: boolean, detail?: unknown) => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail !== undefined ? " :: " + JSON.stringify(detail) : ""}`);
};

const cleanupSql: string[] = [];
const run = async (q: string) => (await db.execute(sql.raw(q))).rows as any[];

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

  // ---- users ----
  const allUsers = await storage.users.getAllUsers();
  let staffUser: any = null;
  let plainUser: any = null;
  for (const u of allUsers) {
    const isStaff = await storage.users.userHasPermission(u.id, "staff");
    const isAdmin = await storage.users.userHasPermission(u.id, "admin");
    const isEmployer = await storage.users.userHasPermission(u.id, "employer");
    if (!staffUser && isStaff) staffUser = u;
    if (!plainUser && !isStaff && !isAdmin && !isEmployer) plainUser = u;
    if (staffUser && plainUser) break;
  }
  if (!staffUser) throw new Error("no staff user in dev DB");

  const [employerRole] = await run(
    `SELECT r.id FROM roles r JOIN role_permissions rp ON rp.role_id=r.id AND rp.permission_key='employer' LIMIT 1`,
  );
  if (!employerRole) throw new Error("no role granting 'employer' permission in dev DB");

  const TS = Date.now();
  const mkEmployerUser = async (tag: string, contactId: string, email: string) => {
    const [u] = await run(
      `INSERT INTO users (id, email, account_status, is_active, created_at, updated_at)
       VALUES (gen_random_uuid(), '${email}', 'active', true, now(), now()) RETURNING *`,
    );
    cleanupSql.push(`DELETE FROM users WHERE id='${u.id}'`);
    await run(`INSERT INTO user_roles (user_id, role_id) VALUES ('${u.id}', '${employerRole.id}')`);
    cleanupSql.push(`DELETE FROM user_roles WHERE user_id='${u.id}'`);
    return u;
  };

  // ---- fixtures: employers A/B, contacts, links, job on A ----
  const mkContact = async (name: string, email: string) => {
    const [c] = await run(
      `INSERT INTO contacts (display_name, email) VALUES ('${name}', '${email}') RETURNING id`,
    );
    cleanupSql.push(`DELETE FROM contacts WHERE id='${c.id}'`);
    return c.id;
  };
  const mkEmployer = async (name: string) => {
    const [e] = await run(
      `INSERT INTO employers (name) VALUES ('${name}') RETURNING id`,
    );
    cleanupSql.push(`DELETE FROM employers WHERE id='${e.id}'`);
    return e.id;
  };
  const link = async (employerId: string, contactId: string) => {
    const [l] = await run(
      `INSERT INTO employer_contacts (employer_id, contact_id) VALUES ('${employerId}', '${contactId}') RETURNING id`,
    );
    cleanupSql.push(`DELETE FROM employer_contacts WHERE id='${l.id}'`);
    return l.id;
  };

  const empA = await mkEmployer(`verify-jec-A-${TS}`);
  const empB = await mkEmployer(`verify-jec-B-${TS}`);

  const contactA1 = await mkContact("JEC A1", `jec-a1-${TS}@verify.local`);
  const contactA2 = await mkContact("JEC A2", `jec-a2-${TS}@verify.local`);
  const contactB1 = await mkContact("JEC B1", `jec-b1-${TS}@verify.local`);
  const linkA1 = await link(empA, contactA1);
  await link(empA, contactA2);
  await link(empB, contactB1);

  // Employer users: contact match is by user EMAIL === contact email.
  const userAEmail = `jec-user-a-${TS}@verify.local`;
  const userBEmail = `jec-user-b-${TS}@verify.local`;
  const contactUserA = await mkContact("JEC User A", userAEmail);
  const contactUserB = await mkContact("JEC User B", userBEmail);
  await link(empA, contactUserA);
  await link(empB, contactUserB);
  const employerUserA = await mkEmployerUser("a", contactUserA, userAEmail);
  const employerUserB = await mkEmployerUser("b", contactUserB, userBEmail);

  const [jt] = await run(`SELECT id FROM options_dispatch_job_type LIMIT 1`);
  const [job] = await run(
    `INSERT INTO dispatch_jobs (title, employer_id, job_type_id, status, start_ymd)
     VALUES ('jec verify job', '${empA}', '${jt.id}', 'open', '2026-08-12') RETURNING id`,
  );
  cleanupSql.push(`DELETE FROM dispatch_jobs WHERE id='${job.id}'`);
  const [otherJob] = await run(
    `INSERT INTO dispatch_jobs (title, employer_id, job_type_id, status, start_ymd)
     VALUES ('jec verify other job', '${empB}', '${jt.id}', 'open', '2026-08-12') RETURNING id`,
  );
  cleanupSql.push(`DELETE FROM dispatch_jobs WHERE id='${otherJob.id}'`);
  cleanupSql.push(`DELETE FROM dispatch_job_employer_contacts WHERE job_id IN ('${job.id}','${otherJob.id}')`);

  // ---- harness ----
  let currentUser: any = staffUser;
  const app = express();
  app.use(express.json());
  const fakeAuth = (req: any, _res: any, next: any) => {
    req.user = { claims: { sub: currentUser.id }, dbUser: currentUser };
    req.isAuthenticated = () => true;
    next();
  };
  registerDispatchJobEmployerContactsRoutes(
    app,
    ((req: any, res: any, next: any) => fakeAuth(req, res, () => (requireAuth as any)(req, res, next))) as any,
    requireAccess as any,
  );
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const api = (path: string, init?: any) =>
    fetch(`${base}/api/dispatch-jobs/${job.id}/employer-contacts${path}`, init);
  const post = (contactId: string) =>
    api("", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contactId }) });

  try {
    // staff: candidates lists employer A contacts only
    const candRes = await api("/candidates");
    const cands = await candRes.json();
    check("staff lists candidates", candRes.status === 200, { status: candRes.status });
    check(
      "candidates are employer A's contacts only",
      Array.isArray(cands) &&
        cands.some((c: any) => c.contactId === contactA1) &&
        !cands.some((c: any) => c.contactId === contactB1),
      { count: cands.length },
    );

    // staff: add same-employer contact
    const addRes = await post(contactA1);
    const added = await addRes.json();
    check("staff adds same-employer contact (201)", addRes.status === 201, { status: addRes.status });

    // duplicate → 409
    check("duplicate association → 409", (await post(contactA1)).status === 409);

    // cross-employer contact → 400
    check("cross-employer contact rejected 400", (await post(contactB1)).status === 400);

    // unknown contact → 400
    const [ghost] = await run(`SELECT gen_random_uuid() AS id`);
    check("unknown contact rejected 400", (await post(ghost.id)).status === 400);

    // association survives removal from employer
    await run(`DELETE FROM employer_contacts WHERE id='${linkA1}'`);
    const listAfter = await (await api("")).json();
    check(
      "association survives contact removed from employer",
      listAfter.associations.some((a: any) => a.contactId === contactA1),
      { count: listAfter.associations.length },
    );

    // delete scoped to job: association on other job not deletable here
    const [foreign] = await run(
      `INSERT INTO dispatch_job_employer_contacts (job_id, contact_id) VALUES ('${otherJob.id}', '${contactB1}') RETURNING id`,
    );
    check("delete of another job's association → 404", (await api(`/${foreign.id}`, { method: "DELETE" })).status === 404);

    // staff delete own association → 204
    check("staff removes association (204)", (await api(`/${added.id}`, { method: "DELETE" })).status === 204);

    // employer user linked to job's employer: list + candidates + add
    currentUser = employerUserA;
    check("linked employer user lists (200)", (await api("")).status === 200);
    check("linked employer user lists candidates (200)", (await api("/candidates")).status === 200);
    const empAdd = await post(contactA2);
    const empAdded = await empAdd.json();
    check("linked employer user adds contact (201)", empAdd.status === 201, { status: empAdd.status });
    check("linked employer user cross-employer add → 400", (await post(contactB1)).status === 400);
    check("linked employer user removes (204)", (await api(`/${empAdded.id}`, { method: "DELETE" })).status === 204);

    // employer user of a DIFFERENT employer → 403
    currentUser = employerUserB;
    check("unlinked employer user list → 403", (await api("")).status === 403);
    check("unlinked employer user add → 403", (await post(contactA2)).status === 403);

    // revocation: unlink employer user A's contact from employer A → 403 now
    currentUser = employerUserA;
    check("linked employer user still 200 pre-revocation", (await api("")).status === 200);
    await run(`DELETE FROM employer_contacts WHERE employer_id='${empA}' AND contact_id='${contactUserA}'`);
    check("revoked employer user list → 403 (no stale cache)", (await api("")).status === 403);
    check("revoked employer user add → 403", (await post(contactA2)).status === 403);

    // job moved to a different employer: user B becomes linked, A stays out
    await run(`UPDATE dispatch_jobs SET employer_id='${empB}' WHERE id='${job.id}'`);
    currentUser = employerUserB;
    check("after job employer change, new employer's user → 200", (await api("")).status === 200);
    const candsB = await (await api("/candidates")).json();
    check(
      "candidates follow the job's CURRENT employer",
      Array.isArray(candsB) && candsB.some((c: any) => c.contactId === contactB1) && !candsB.some((c: any) => c.contactId === contactA2),
      { count: candsB.length },
    );
    check("after change, old-employer contact add → 400", (await post(contactA2)).status === 400);
    await run(`UPDATE dispatch_jobs SET employer_id='${empA}' WHERE id='${job.id}'`);

    // plain user (no staff/employer) → 403
    if (plainUser) {
      currentUser = plainUser;
      check("plain user list → 403", (await api("")).status === 403);
      check("plain user add → 403", (await post(contactA2)).status === 403);
    } else {
      console.log("SKIP plain-user case (none in dev data)");
    }
  } finally {
    server.close();
    for (const q of cleanupSql.reverse()) await db.execute(sql.raw(q)).catch((e) => console.error("cleanup:", e.message));
  }

  console.log(failures ? `FAILURES: ${failures}` : "ALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  for (const q of cleanupSql.reverse()) await db.execute(sql.raw(q)).catch(() => {});
  process.exit(1);
});
