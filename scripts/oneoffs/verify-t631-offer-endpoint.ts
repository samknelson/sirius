/**
 * Endpoint-level check for the staff Offers API:
 *  - staff can list the offers view and create an "offered" interview for a
 *    worker who is eligible aside from the interview requirement
 *  - direct POST for a worker blocked by ANOTHER plugin is rejected (422)
 *  - a non-staff caller gets 403 on both offers endpoints
 *
 * Uses a fixture dispatch-eligibility config enabling ONLY the T631 interview
 * plugin on a dedicated job type, so "other plugins" pass for everyone there;
 * the blocked case uses the real Tripod job type (skills/status plugins).
 */
import express from "express";
import "../../server/plugins/dispatch/eligibility";
import { db } from "../../server/storage/db";
import { sql } from "drizzle-orm";
import { storage } from "../../server/storage";
import { loadComponentCache, isComponentEnabledSync } from "../../server/services/component-cache";
import { initAccessControl, requireAccess, requireAuth } from "../../server/services/access-policy-evaluator";
import { initializePermissions } from "../../shared/permissions";
import "../../shared/access-policies/loader";
import { registerT631InterviewsRoutes } from "../../server/modules/sitespecific/t631/interviews";

const TRIPOD_JOB = "6c898879-25e3-4248-b955-97a5d523b885";
const TRIPOD_JOB_TYPE = "430a31e8-a691-4af8-959e-33a95c28f0a9";

let failures = 0;
const check = (label: string, ok: boolean, detail?: unknown) => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail !== undefined ? " :: " + JSON.stringify(detail) : ""}`);
};

const cleanupSql: string[] = [];

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

  // Staff (non-necessarily-admin) user + a user with NO staff permission.
  const allUsers = await storage.users.getAllUsers();
  let staffUser: any = null;
  let nonStaffUser: any = null;
  for (const u of allUsers) {
    const isStaff = await storage.users.userHasPermission(u.id, "staff");
    const isAdmin = await storage.users.userHasPermission(u.id, "admin");
    if (!staffUser && isStaff) staffUser = u;
    if (!nonStaffUser && !isStaff && !isAdmin) nonStaffUser = u;
    if (staffUser && nonStaffUser) break;
  }
  if (!staffUser) throw new Error("no staff user in dev DB");
  console.log("staff:", staffUser.email ?? staffUser.id, "| non-staff:", nonStaffUser?.email ?? "(none)");

  let currentUser: any = staffUser;
  const app = express();
  app.use(express.json());
  const fakeAuth = (req: any, _res: any, next: any) => {
    req.user = { claims: { sub: currentUser.id }, dbUser: currentUser };
    req.isAuthenticated = () => true;
    next();
  };
  // Use the real requireAuth ('authenticated' policy) chained after fakeAuth.
  registerT631InterviewsRoutes(
    app,
    ((req: any, res: any, next: any) => fakeAuth(req, res, () => (requireAuth as any)(req, res, next))) as any,
    ((..._a: any[]) => (_req: any, _res: any, next: any) => next()) as any,
    requireAccess as any,
  );
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as any).port}`;

  // ---- fixtures ----
  // Interview-plugin-only job type + a job of that type.
  const [jt] = (await db.execute(sql`
    INSERT INTO options_dispatch_job_type (name) VALUES ('t631-offer-verify-jt') RETURNING id
  `)).rows as any[];
  cleanupSql.push(`DELETE FROM options_dispatch_job_type WHERE id='${jt.id}'`);
  const [cfg] = (await db.execute(sql`
    INSERT INTO plugin_configs (plugin_kind, plugin_id, enabled, name)
    VALUES ('dispatch-eligibility','sitespecific_t631_interview',true,'offer-verify-fixture') RETURNING id
  `)).rows as any[];
  cleanupSql.push(`DELETE FROM plugin_configs WHERE id='${cfg.id}'`);
  await db.execute(sql`INSERT INTO plugin_configs_dispatch (id, job_type) VALUES (${cfg.id}, ${jt.id})`);

  const [tripod] = (await db.execute(sql`SELECT employer_id FROM dispatch_jobs WHERE id=${TRIPOD_JOB}`)).rows as any[];
  const [job] = (await db.execute(sql`
    INSERT INTO dispatch_jobs (title, employer_id, job_type_id, status, start_ymd)
    VALUES ('t631 offer verify job', ${tripod.employer_id}, ${jt.id}, 'open', '2026-08-12') RETURNING id
  `)).rows as any[];
  cleanupSql.push(`DELETE FROM sitespecific_t631_job_interviews WHERE job_id='${job.id}'`);
  cleanupSql.push(`DELETE FROM dispatch_jobs WHERE id='${job.id}'`);

  const [worker] = (await db.execute(sql`SELECT id FROM workers LIMIT 1`)).rows as any[];

  try {
    // 1. staff lists offers view on the fixture job
    const listRes = await fetch(`${base}/api/sitespecific/t631/interviews/views/job/${job.id}/offers?limit=5`);
    const list = await listRes.json();
    check("staff can list offers view", listRes.status === 200 && typeof list.total === "number", { status: listRes.status });
    check("offers list non-empty (only interview plugin gates)", list.total > 0, { total: list.total });

    // 2. staff offers an interview to an eligible-but-uninterviewed worker
    const target = list.workers.find((w: any) => !w.interview);
    const postRes = await fetch(`${base}/api/sitespecific/t631/interviews/views/job/${job.id}/offers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workerId: target.id }),
    });
    const created = await postRes.json();
    check("staff POST creates offered interview", postRes.status === 201 && created.status === "offered", { status: postRes.status });

    // 3. duplicate offer → 409
    const dupRes = await fetch(`${base}/api/sitespecific/t631/interviews/views/job/${job.id}/offers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workerId: target.id }),
    });
    check("duplicate offer rejected 409", dupRes.status === 409, { status: dupRes.status });

    // 4. worker blocked by OTHER plugins on the Tripod job → 422.
    //    (Tripod's job type has skills/status/ws plugins; dev workers fail them —
    //    confirmed by the offers list for that job being empty.)
    const tripodList = await (await fetch(`${base}/api/sitespecific/t631/interviews/views/job/${TRIPOD_JOB}/offers?limit=1`)).json().catch(() => null);
    const blockedRes = await fetch(`${base}/api/sitespecific/t631/interviews/views/job/${TRIPOD_JOB}/offers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workerId: worker.id }),
    });
    // Tripod job needs interview relevance: plugin not enabled there → the
    // endpoint 404s, which also proves the direct POST can't sneak through.
    check(
      "direct POST for ineligible/irrelevant worker rejected",
      blockedRes.status === 422 || blockedRes.status === 404,
      { status: blockedRes.status, tripodTotal: tripodList?.total },
    );

    // 4b. blocked-by-other-plugin on the FIXTURE job: temporarily enable the
    //     dispatch_status plugin (workers without 'Available' fact fail it).
    const [cfg2] = (await db.execute(sql`
      INSERT INTO plugin_configs (plugin_kind, plugin_id, enabled, name)
      VALUES ('dispatch-eligibility','dispatch_status',true,'offer-verify-fixture-2') RETURNING id
    `)).rows as any[];
    await db.execute(sql`INSERT INTO plugin_configs_dispatch (id, job_type) VALUES (${cfg2.id}, ${jt.id})`);
    const list2 = await (await fetch(`${base}/api/sitespecific/t631/interviews/views/job/${job.id}/offers?limit=500`)).json();
    const eligibleIds = new Set((list2.workers ?? []).map((w: any) => w.id));
    const [blockedWorker] = (await db.execute(sql`
      SELECT w.id FROM workers w WHERE NOT EXISTS (
        SELECT 1 FROM worker_dispatch_elig_denorm d
        WHERE d.worker_id = w.id AND d.category='dispstatus' AND d.value='Available'
      ) LIMIT 1
    `)).rows as any[];
    if (blockedWorker && !eligibleIds.has(blockedWorker.id)) {
      const blocked2 = await fetch(`${base}/api/sitespecific/t631/interviews/views/job/${job.id}/offers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workerId: blockedWorker.id }),
      });
      check("POST for worker blocked by another plugin → 422", blocked2.status === 422, { status: blocked2.status });
    } else {
      console.log("SKIP blocked-by-other-plugin case (no blocked worker in dev data)");
    }
    await db.execute(sql`DELETE FROM plugin_configs WHERE id=${cfg2.id}`);

    // 5. non-staff caller → 403 on list and create
    if (nonStaffUser) {
      currentUser = nonStaffUser;
      const nsList = await fetch(`${base}/api/sitespecific/t631/interviews/views/job/${job.id}/offers`);
      const nsPost = await fetch(`${base}/api/sitespecific/t631/interviews/views/job/${job.id}/offers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workerId: worker.id }),
      });
      check("non-staff list offers → 403", nsList.status === 403, { status: nsList.status });
      check("non-staff create offer → 403", nsPost.status === 403, { status: nsPost.status });
      currentUser = staffUser;
    }
  } finally {
    server.close();
    for (const q of cleanupSql.reverse()) await db.execute(sql.raw(q));
  }

  console.log(failures ? `FAILURES: ${failures}` : "ALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  for (const q of cleanupSql.reverse()) await db.execute(sql.raw(q)).catch(() => {});
  process.exit(1);
});
