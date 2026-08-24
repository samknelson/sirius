/**
 * One-off e2e check (Tasks #992/#997): worker eligibility is enforced
 * server-side at BOTH dispatch creation (POST /api/dispatches) and acceptance
 * (set-status + generic PUT), using the FULL job-configured eligibility plugin
 * set, evaluated PURELY from worker_dispatch_elig_denorm facts (no live
 * source-row reads). The script recomputes the ban denorm facts after each
 * ban write, standing in for the after-commit event listener that does the
 * same in the running app.
 *
 * Run:
 *   npx tsx scripts/oneoffs/verify-dispatch-eligibility-enforcement.ts
 */
import express from "express";
import { eq } from "drizzle-orm";
import { storage } from "../../server/storage";
import { db } from "../../server/storage/db";
import { optionsDispatchJobType } from "@shared/schema";
import { loadComponentCache, isComponentEnabledSync } from "../../server/services/component-cache";
import { initAccessControl } from "../../server/services/access-policy-evaluator";
import { initializePermissions } from "../../shared/permissions";
import "../../shared/access-policies/loader";
import { registerDispatchesRoutes } from "../../server/modules/dispatch/dispatches";
// Register the eligibility plugins (read side), the ban denorm plugin (write
// side — maintains the `ban` facts), and the worker-ban behavior plugins the
// denorm compute consults. Import the denorm plugin file directly, not the
// denorm barrel (the barrel's registry init breaks under standalone tsx).
import "../../server/plugins/dispatch/eligibility/plugins/ban";
import "../../server/plugins/dispatch/eligibility/plugins/ban-jobtype";
import "../../server/plugins/dispatch/eligibility/plugins/singleshift";
import "../../server/plugins/worker-bans/plugins/all-dispatch";
import "../../server/plugins/worker-bans/plugins/dispatch-job-type";
import "../../server/plugins/system/denorm/plugins/dispatch/ban";
import { recomputeStaleDenorm } from "../../server/plugins/system/denorm/recompute";

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

  if (!isComponentEnabledSync("dispatch") || !isComponentEnabledSync("dispatch.ban")) {
    console.error("FAIL: dispatch / dispatch.ban components not enabled in this DB; cannot verify");
    process.exit(1);
  }

  const allUsers = await storage.users.getAllUsers();
  let adminUser: any = null;
  for (const u of allUsers) {
    if (await storage.users.userHasPermission(u.id, "admin")) { adminUser = u; break; }
  }
  if (!adminUser) {
    console.error("FAIL: no admin user in dev DB; cannot verify");
    process.exit(1);
  }

  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.user = { claims: { sub: adminUser.id }, dbUser: adminUser };
    req.isAuthenticated = () => true;
    next();
  });
  const passthrough = (_req: any, _res: any, next: any) => next();
  registerDispatchesRoutes(app, passthrough, () => passthrough);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as any).port}`;

  let failures = 0;
  const check = (label: string, ok: boolean, detail?: unknown) => {
    if (!ok) failures++;
    console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail !== undefined ? " :: " + JSON.stringify(detail) : ""}`);
  };

  // ---- seed data -----------------------------------------------------------
  const cleanup: Array<() => Promise<unknown>> = [];
  try {
    const employers = await storage.employers.getAllEmployers();
    if (employers.length === 0) throw new Error("no employers in dev DB");
    const employer = employers[0];

    const [jobType] = await db
      .insert(optionsDispatchJobType)
      .values({ name: "T992 Verify Job Type" })
      .returning();
    cleanup.push(() => db.delete(optionsDispatchJobType).where(eq(optionsDispatchJobType.id, jobType.id)));

    const job = await storage.dispatchJobs.create({
      employerId: employer.id,
      jobTypeId: jobType.id,
      title: "T992 verify job",
      status: "open",
      startYmd: "2031-03-01",
    } as any);
    cleanup.push(() => storage.dispatchJobs.delete(job.id));

    // Enable the ban + singleshift eligibility plugins for this job type —
    // the same per-job-type config set the eligible-worker listing uses.
    for (const pluginId of ["dispatch_ban", "dispatch_singleshift"]) {
      const cfg = await storage.pluginConfigs.create({
        pluginKind: "dispatch-eligibility",
        pluginId,
        enabled: true,
        name: `T992 ${pluginId}`,
        data: {},
      } as any);
      cleanup.push(() => storage.pluginConfigs.delete(cfg.id));
      await storage.pluginConfigs.upsertSubsidiary("dispatch-eligibility", { id: cfg.id, jobType: jobType.id });
    }

    // Two workers with no existing bans.
    const candidates = (await storage.workers.getAllWorkers()).slice(0, 40);
    const clean: any[] = [];
    for (const w of candidates) {
      const bans = await storage.workerBans.getByWorker(w.id);
      if (bans.length === 0) clean.push(w);
      if (clean.length >= 2) break;
    }
    if (clean.length < 2) throw new Error("could not find two unbanned workers in dev DB");
    const [workerA, workerB] = clean;

    // Stand-in for the after-commit denorm listener: mark the worker's `ban`
    // facts stale and recompute them, exactly what the running app does
    // asynchronously after a ban save/delete.
    const banDenormConfigs = await storage.pluginConfigs.getByKindAndPlugin("denorm", "dispatch_ban");
    if (banDenormConfigs.length === 0) throw new Error("dispatch_ban denorm plugin config missing");
    const recomputeBanFacts = async (workerId: string) => {
      await storage.denorm.upsertStatus({
        configId: banDenormConfigs[0].id,
        entityId: workerId,
        entityType: "worker",
        status: "stale",
      });
      await recomputeStaleDenorm({ pluginId: "dispatch_ban" });
    };

    const post = (path: string, body: unknown) =>
      fetch(`${base}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const put = (path: string, body: unknown) =>
      fetch(`${base}${path}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

    // ---- 1. create allowed for an eligible worker --------------------------
    let res = await post("/api/dispatches", { jobId: job.id, workerId: workerA.id, status: "pending" });
    const dispatchA = await res.json();
    check("create dispatch for eligible worker → 201", res.status === 201, { status: res.status });

    // ---- 2. create rejected for a banned worker ----------------------------
    const banB = await storage.workerBans.create({
      workerId: workerB.id,
      type: "dispatch",
      startDate: new Date() as any,
      message: "T992 test ban",
    } as any);
    cleanup.push(async () => { try { await storage.workerBans.delete(banB.id); } catch {} });
    await recomputeBanFacts(workerB.id);

    res = await post("/api/dispatches", { jobId: job.id, workerId: workerB.id, status: "pending" });
    let body: any = await res.json();
    check("create dispatch for banned worker → 403", res.status === 403, { status: res.status, body });
    check(
      "create rejection names plugin + message",
      res.status === 403 &&
        Array.isArray(body.eligibilityFailures) &&
        body.eligibilityFailures.some((f: any) => f.pluginName === "Worker Ban" && typeof f.explanation === "string" && f.explanation.length > 0) &&
        typeof body.message === "string" && body.message.includes("Worker Ban"),
      body.eligibilityFailures,
    );

    // ---- 3. accept rejected when eligibility lapses after dispatch ---------
    const banA = await storage.workerBans.create({
      workerId: workerA.id,
      type: "dispatch",
      startDate: new Date() as any,
      message: "T992 lapse ban",
    } as any);
    await recomputeBanFacts(workerA.id);

    res = await post(`/api/dispatches/${dispatchA.id}/set-status`, { status: "accepted" });
    body = await res.json();
    check("set-status accept after ban → 403", res.status === 403, { status: res.status, body });
    check(
      "set-status rejection names plugin + message",
      res.status === 403 && Array.isArray(body.eligibilityFailures) && body.eligibilityFailures.some((f: any) => f.pluginName === "Worker Ban" && f.explanation),
      body.eligibilityFailures,
    );

    res = await put(`/api/dispatches/${dispatchA.id}`, { status: "accepted" });
    body = await res.json();
    check("generic PUT accept after ban → 403", res.status === 403, { status: res.status, body });
    check(
      "PUT rejection names plugin + message",
      res.status === 403 && Array.isArray(body.eligibilityFailures) && body.eligibilityFailures.some((f: any) => f.pluginName === "Worker Ban" && f.explanation),
      body.eligibilityFailures,
    );

    // ---- 4. lift ban → accept succeeds (own pending dispatch doesn't block,
    //         singleshift enabled) -------------------------------------------
    await storage.workerBans.delete(banA.id);
    await recomputeBanFacts(workerA.id);
    res = await post(`/api/dispatches/${dispatchA.id}/set-status`, { status: "accepted" });
    body = await res.json();
    check("accept after ban lifted (singleshift enabled, own pending dispatch) → 200", res.status === 200, { status: res.status, body });

    // ---- 5. non-accept statuses remain unrestricted for banned workers -----
    // (workerB has an active ban; create was blocked, but declining etc. of an
    // existing dispatch must not be. Create one for B on a config-free job.)
    const jobNoType = await storage.dispatchJobs.create({
      employerId: employer.id,
      jobTypeId: null,
      title: "T992 no-jobtype job",
      status: "open",
      startYmd: "2031-03-02",
    } as any);
    cleanup.push(() => storage.dispatchJobs.delete(jobNoType.id));
    res = await post("/api/dispatches", { jobId: jobNoType.id, workerId: workerB.id, status: "pending" });
    const dispatchB = await res.json();
    check("create on job with no eligibility configs → 201 (no criteria configured)", res.status === 201, { status: res.status });
    if (res.status === 201) {
      res = await post(`/api/dispatches/${dispatchB.id}/set-status`, { status: "declined" });
      check("decline while banned → 200 (only accept is gated)", res.status === 200, { status: res.status });
    }
  } finally {
    for (const fn of cleanup.reverse()) {
      try { await fn(); } catch (e) { console.warn("cleanup failed:", (e as Error).message); }
    }
    server.close();
  }

  console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
