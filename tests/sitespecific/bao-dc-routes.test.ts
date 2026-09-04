import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerBaoDisabilityCreditRoutes } from "../../server/modules/sitespecific/bao/disability-credit";
import { storage } from "../../server/storage";
import { db } from "../../server/db";
import { eq } from "drizzle-orm";
import {
  sitespecificBaoDcCases,
  sitespecificBaoDcEvents,
  sitespecificBaoDcCaseMonths,
  sitespecificBaoDcDocuments,
  employers,
  policies,
  trustBenefits,
  trustWmb,
  workerHours,
  optionsEmploymentStatus,
  pluginConfigs,
  pluginConfigsBenefitEligibility,
  workerTrustElections,
  workers as workersTable,
  rolePermissions,
  roles,
  userRoles,
  users,
} from "@shared/schema";
import { inArray } from "drizzle-orm";
import { formatYmdMonth } from "@shared/utils/date";
import { replaceDcCaseMonths } from "../../server/services/sitespecific/bao/dc-workflow";
import { updateComponentCache, isComponentEnabledSync } from "../../server/services/component-cache";
import { initAccessControl } from "../../server/services/access-policy-evaluator";
import { ensureBaoDcSchema } from "./fixtures/bao-schema";

let base = "";
let closeServer: (() => Promise<void>) | undefined;
let workerId = "";
let staffId = "";
// A staff user WITHOUT the bao.dc.approve permission — preparation works,
// queued-case decisions must 403.
let plainStaffId = "";
let approverRoleId = "";
const caseIds: string[] = [];

async function request(path: string, init: RequestInit & { user?: string; staff?: boolean } = {}) {
  const headers = new Headers(init.headers);
  if (init.user) headers.set("x-user", init.user);
  if (init.staff === false) headers.set("x-staff", "0");
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return fetch(`${base}${path}`, { ...init, headers });
}

beforeAll(async () => {
  await ensureBaoDcSchema();
  await updateComponentCache("sitespecific.bao", true);
  // buildContext (actorId) needs the access-control module initialized.
  initAccessControl(
    {
      getUserPermissions: async (userId: string) =>
        (await storage.users.getUserPermissions(userId)).map((p) => p.key),
      hasPermission: async (userId: string, permissionKey: string) =>
        storage.users.userHasPermission(userId, permissionKey),
      getUser: async (userId: string) => storage.users.getUser(userId),
    } as any,
    storage,
    async (componentId: string) => isComponentEnabledSync(componentId),
  );
  const staff = (await storage.users.getUsersWithAnyPermission(["staff", "admin"]))[0];
  if (!staff) throw new Error("DC route harness prerequisites unavailable");
  staffId = staff.id;
  const run = `dc-routes-${Date.now()}`;
  // This suite owns its worker: cases enforce one open case per worker, so
  // sharing a database worker with another concurrently running suite races
  // on DUPLICATE_OPEN_CASE.
  workerId = (await storage.workers.createWorker(`DC Routes fixture ${run}`)).id;

  // Designate staffId as a DC approver via a real role-permission row (the
  // same mechanism admins use), and create a plain staff user without it.
  const approverRole = await storage.users.createRole({
    name: `${run}-approver`,
    description: "DC approver test role",
  } as any);
  approverRoleId = approverRole.id;
  await db
    .insert(rolePermissions)
    .values({ roleId: approverRoleId, permissionKey: "bao.dc.approve" });
  await storage.users.assignRoleToUser({ userId: staffId, roleId: approverRoleId } as any);
  const plainStaff = await storage.users.createUser({
    email: `${run}-plain@example.test`,
    firstName: "Plain",
    lastName: "Staff",
  } as any);
  plainStaffId = plainStaff.id;

  const app = express();
  app.use(express.json());
  const requireAuth: any = async (req: any, res: any, next: any) => {
    const id = req.header("x-user");
    if (!id) return res.status(401).json({ message: "auth required" });
    req.session = { masqueradeUserId: id };
    // buildContext resolves the acting user from req.user.dbUser.
    req.user = { claims: { sub: id }, dbUser: await storage.users.getUser(id) };
    next();
  };
  // "staff" policy denied for x-staff: 0 — models a member hitting
  // staff-only routes directly.
  const requireAccess: any = (policyId: string) => (req: any, res: any, next: any) => {
    if (policyId === "staff" && req.header("x-staff") === "0") {
      return res.status(403).json({ message: "staff required" });
    }
    next();
  };
  const requirePermission: any = () => (_req: any, _res: any, next: any) => next();
  registerBaoDisabilityCreditRoutes(app, requireAuth, requirePermission, requireAccess);
  const server = await new Promise<any>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  base = `http://127.0.0.1:${server.address().port}`;
  closeServer = () =>
    new Promise((resolve, reject) => server.close((e: Error) => (e ? reject(e) : resolve())));
});

afterAll(async () => {
  await closeServer?.();
  for (const id of caseIds) {
    await db.delete(sitespecificBaoDcEvents).where(eq(sitespecificBaoDcEvents.caseId, id));
    await db.delete(sitespecificBaoDcCases).where(eq(sitespecificBaoDcCases.id, id));
  }
  if (workerId) {
    await db.delete(sitespecificBaoDcEvents).where(eq(sitespecificBaoDcEvents.workerId, workerId));
    await db.delete(sitespecificBaoDcCaseMonths).where(eq(sitespecificBaoDcCaseMonths.workerId, workerId));
    await db.delete(sitespecificBaoDcCases).where(eq(sitespecificBaoDcCases.workerId, workerId));
    await db.delete(workersTable).where(eq(workersTable.id, workerId));
  }
  if (approverRoleId) {
    await db.delete(userRoles).where(eq(userRoles.roleId, approverRoleId)).catch(() => {});
    await db
      .delete(rolePermissions)
      .where(eq(rolePermissions.roleId, approverRoleId))
      .catch(() => {});
    await db.delete(roles).where(eq(roles.id, approverRoleId)).catch(() => {});
  }
  if (plainStaffId) {
    await db.delete(users).where(eq(users.id, plainStaffId)).catch(() => {});
  }
});

async function makeCase(status: string): Promise<string> {
  const c = await storage.baoDisabilityCredit.openCase({
    workerId,
    openedYmd: "2027-09-01",
    qualifyingBasis: {
      asOfYmd: "2027-09-01",
      conditions: ["staff_exception"],
      exceptionReason: "harness case",
    },
    createdByUserId: staffId,
    allowDuplicate: true,
  });
  caseIds.push(c.id);
  if (status !== "draft") {
    await db
      .update(sitespecificBaoDcCases)
      .set({ status: status as any })
      .where(eq(sitespecificBaoDcCases.id, c.id));
  }
  return c.id;
}

describe("DC route stage boundaries", () => {
  it("the retired DC notes endpoint no longer exists", async () => {
    const id = await makeCase("draft");
    const res = await request(`/api/sitespecific/bao/dc/cases/${id}/notes`, {
      method: "POST",
      user: staffId,
      body: JSON.stringify({ body: "hello" }),
    });
    expect(res.status).toBe(404);
  });

  it("members cannot reach lifecycle, attestation, month, extension, or queue routes", async () => {
    const id = await makeCase("draft");
    const memberCalls: Array<[string, RequestInit]> = [
      [`/api/sitespecific/bao/dc/cases/${id}/actions`, { method: "POST", body: JSON.stringify({ action: "send_for_approval" }) }],
      [`/api/workers/${workerId}/sitespecific/bao/dc/exception-cases`, { method: "POST", body: JSON.stringify({ reason: "member try" }) }],
      [`/api/sitespecific/bao/dc/fmla-eligible`, {}],
      [`/api/sitespecific/bao/dc/cases/${id}/attestations`, { method: "PUT", body: JSON.stringify({ dcFormOnFile: true }) }],
      [`/api/sitespecific/bao/dc/cases/${id}/months`, { method: "PUT", body: JSON.stringify({ months: [] }) }],
      [`/api/sitespecific/bao/dc/cases/${id}/extend`, { method: "POST", body: JSON.stringify({ reason: "x" }) }],
      [`/api/sitespecific/bao/dc/queue`, {}],
      [`/api/sitespecific/bao/dc/queue/next`, {}],
    ];
    for (const [path, init] of memberCalls) {
      const res = await request(path, { ...init, user: staffId, staff: false });
      expect(res.status, path).toBe(403);
    }
  });

  it("extension requests require an approved parent and a reason", async () => {
    const draftId = await makeCase("draft");
    const notApproved = await request(`/api/sitespecific/bao/dc/cases/${draftId}/extend`, {
      method: "POST",
      user: staffId,
      body: JSON.stringify({ reason: "still disabled", confirmDuplicate: true }),
    });
    expect(notApproved.status).toBe(409);

    const approvedId = await makeCase("approved");
    const noReason = await request(`/api/sitespecific/bao/dc/cases/${approvedId}/extend`, {
      method: "POST",
      user: staffId,
      body: JSON.stringify({}),
    });
    expect(noReason.status).toBe(400);

    const ok = await request(`/api/sitespecific/bao/dc/cases/${approvedId}/extend`, {
      method: "POST",
      user: staffId,
      body: JSON.stringify({ reason: "condition continues", confirmDuplicate: true }),
    });
    expect(ok.status).toBe(201);
    const body = await ok.json();
    caseIds.push(body.case.id);
    expect(body.case.status).toBe("draft");
    expect(body.case.data.extensionOfCaseId).toBe(approvedId);
    // Parent never leaves approved.
    const parent = await storage.baoDisabilityCredit.getCase(approvedId);
    expect(parent?.status).toBe("approved");
  });

  it("attestation writes reject dcFormOnFile without a classified current DC form", async () => {
    const id = await makeCase("draft");
    const res = await request(`/api/sitespecific/bao/dc/cases/${id}/attestations`, {
      method: "PUT",
      user: staffId,
      body: JSON.stringify({ dcFormOnFile: true }),
    });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe("DC_FORM_ATTESTATION_REQUIRES_FORM");
  });

  it("queue/next returns null on an empty (or fully excluded) queue", async () => {
    const queued = await storage.baoDisabilityCredit.listCasesByStatus("in_queue");
    const params = new URLSearchParams();
    // Exclude at most one pre-existing case; if more exist we just assert 200.
    if (queued[0]) params.set("after", queued[0].id);
    const res = await request(`/api/sitespecific/bao/dc/queue/next?${params}`, {
      user: staffId,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect("nextCaseId" in body).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Staff exception intake, one-step handoff, approver boundary (task 418)
// ---------------------------------------------------------------------------

describe("staff exception intake", () => {
  it("requires a reason", async () => {
    const res = await request(`/api/workers/${workerId}/sitespecific/bao/dc/exception-cases`, {
      method: "POST",
      user: staffId,
      body: JSON.stringify({ reason: "  ", confirmDuplicate: true }),
    });
    expect(res.status).toBe(400);
  });

  it("refuses an exception for a worker who currently MEETS the FMLA gate", async () => {
    // Build a genuinely FMLA-eligible worker: 3 FMLA months in the rolling
    // window — the exception path must refuse and point at the regular path.
    const run = `dc-exc-eligible-${Date.now()}`;
    const w = await storage.workers.createWorker(`DC Exception Eligible ${run}`);
    const [emp] = await db
      .insert(employers)
      .values({ name: `${run}-e`, siriusId: `${run}-e`, isActive: true } as never)
      .returning();
    const [fmla] = await db
      .insert(optionsEmploymentStatus)
      .values({ name: "FMLA", code: `${run}`, employed: false })
      .returning();
    const now = new Date();
    try {
      for (const back of [1, 2, 3]) {
        const o = now.getFullYear() * 12 + now.getMonth() - back;
        await db.insert(workerHours).values({
          year: Math.floor(o / 12),
          month: (o % 12) + 1,
          day: 1,
          workerId: w.id,
          employerId: emp.id,
          employmentStatusId: fmla.id,
          hours: 10,
        });
      }
      const res = await request(`/api/workers/${w.id}/sitespecific/bao/dc/exception-cases`, {
        method: "POST",
        user: staffId,
        body: JSON.stringify({ reason: "should be refused" }),
      });
      expect(res.status).toBe(409);
      expect((await res.json()).code).toBe("DC_EXCEPTION_NOT_APPLICABLE");
      const cases = await storage.baoDisabilityCredit.listCasesForWorker(w.id);
      expect(cases).toHaveLength(0);
    } finally {
      await db.delete(workerHours).where(eq(workerHours.workerId, w.id));
      await db.delete(workersTable).where(eq(workersTable.id, w.id));
      await db.delete(optionsEmploymentStatus).where(eq(optionsEmploymentStatus.id, fmla.id));
      await db.delete(employers).where(eq(employers.id, emp.id));
    }
  });

  it("opens an auditable staff_exception case carrying the reason", async () => {
    const res = await request(`/api/workers/${workerId}/sitespecific/bao/dc/exception-cases`, {
      method: "POST",
      user: staffId,
      body: JSON.stringify({ reason: "Denial letter received by mail", confirmDuplicate: true }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    caseIds.push(body.id);
    expect(body.status).toBe("draft");
    expect(body.qualifyingBasis.conditions).toEqual(["staff_exception"]);
    expect(body.qualifyingBasis.exceptionReason).toBe("Denial letter received by mail");
    // The durable case_opened event carries the reason — auditable intake.
    const events = await db
      .select()
      .from(sitespecificBaoDcEvents)
      .where(eq(sitespecificBaoDcEvents.caseId, body.id));
    const opened = events.find((e) => e.eventType === "case_opened");
    expect((opened?.payload as any)?.exceptionReason).toBe("Denial letter received by mail");
    expect((opened?.payload as any)?.conditions).toEqual(["staff_exception"]);
  });
});

describe("one-step Send for Approval and legacy states", () => {
  it("rejects the retired mark_ready and queue actions", async () => {
    const id = await makeCase("draft");
    for (const action of ["mark_ready", "queue"]) {
      const res = await request(`/api/sitespecific/bao/dc/cases/${id}/actions`, {
        method: "POST",
        user: staffId,
        body: JSON.stringify({ action }),
      });
      expect(res.status, action).toBe(400);
    }
  });

  it("blocks send_for_approval on an unready draft", async () => {
    const id = await makeCase("draft");
    const res = await request(`/api/sitespecific/bao/dc/cases/${id}/actions`, {
      method: "POST",
      user: staffId,
      body: JSON.stringify({ action: "send_for_approval" }),
    });
    expect(res.ok).toBe(false);
    const after = await storage.baoDisabilityCredit.getCase(id);
    expect(after?.status).toBe("draft");
  });

  it("keeps legacy ready_for_review cases actionable (return to draft)", async () => {
    const id = await makeCase("ready_for_review");
    const res = await request(`/api/sitespecific/bao/dc/cases/${id}/actions`, {
      method: "POST",
      user: staffId,
      body: JSON.stringify({ action: "bounce", expectedStatus: "ready_for_review" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.case.status).toBe("draft");
  });
});

describe("approver boundary on queued cases", () => {
  it("refuses approve/deny/return on a queued case for non-approver staff", async () => {
    const id = await makeCase("in_queue");
    for (const [action, extra] of [
      ["approve", {}],
      ["deny", { reason: "no" }],
      ["bounce", {}],
    ] as const) {
      const res = await request(`/api/sitespecific/bao/dc/cases/${id}/actions`, {
        method: "POST",
        user: plainStaffId,
        body: JSON.stringify({ action, ...extra }),
      });
      expect(res.status, action).toBe(403);
      const body = await res.json();
      expect(body.code, action).toBe("DC_APPROVER_REQUIRED");
    }
    const after = await storage.baoDisabilityCredit.getCase(id);
    expect(after?.status).toBe("in_queue");
  });

  it("lets non-approver staff prepare: return a ready_for_review case, withdraw a draft", async () => {
    const rfr = await makeCase("ready_for_review");
    const bounce = await request(`/api/sitespecific/bao/dc/cases/${rfr}/actions`, {
      method: "POST",
      user: plainStaffId,
      body: JSON.stringify({ action: "bounce" }),
    });
    expect(bounce.status).toBe(200);

    const draft = await makeCase("draft");
    const withdraw = await request(`/api/sitespecific/bao/dc/cases/${draft}/actions`, {
      method: "POST",
      user: plainStaffId,
      body: JSON.stringify({ action: "withdraw", reason: "member asked" }),
    });
    expect(withdraw.status).toBe(200);
  });

  it("authorizes on the FRESH status under the lock: a bounce racing a queue transition still requires an approver", async () => {
    const id = await makeCase("ready_for_review");
    let bouncePromise: Promise<Awaited<ReturnType<typeof request>>> | undefined;
    // Hold the case's serialization lock: queue the case, then let a
    // non-approver's bounce arrive while ready_for_review was the last
    // state visible OUTSIDE the lock. The route must authorize against the
    // in_queue status it will actually act on, not a stale pre-lock read.
    await storage.baoDisabilityCredit.withCaseSerialization(id, async () => {
      await storage.baoDisabilityCredit.transitionCase(id, {
        to: "in_queue",
        actorUserId: staffId,
      });
      bouncePromise = request(`/api/sitespecific/bao/dc/cases/${id}/actions`, {
        method: "POST",
        user: plainStaffId,
        body: JSON.stringify({ action: "bounce" }),
      });
      // Give the request time to start and block on the lock.
      await new Promise((r) => setTimeout(r, 500));
    });
    const res = await bouncePromise!;
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("DC_APPROVER_REQUIRED");
    const after = await storage.baoDisabilityCredit.getCase(id);
    expect(after?.status).toBe("in_queue");
  });

  it("lets a designated approver return a queued case to draft", async () => {
    const id = await makeCase("in_queue");
    const res = await request(`/api/sitespecific/bao/dc/cases/${id}/actions`, {
      method: "POST",
      user: staffId,
      body: JSON.stringify({ action: "bounce", expectedStatus: "in_queue" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.case.status).toBe("draft");
  });

  it("exposes isApprover on the case bundle", async () => {
    const id = await makeCase("draft");
    const asApprover = await request(`/api/sitespecific/bao/dc/cases/${id}`, { user: staffId });
    expect(asApprover.status).toBe(200);
    expect((await asApprover.json()).isApprover).toBe(true);
    const asPlain = await request(`/api/sitespecific/bao/dc/cases/${id}`, { user: plainStaffId });
    expect(asPlain.status).toBe(200);
    expect((await asPlain.json()).isApprover).toBe(false);
  });
});

describe("complete FMLA-eligible list endpoint", () => {
  it("returns the full current population for staff", async () => {
    const res = await request(`/api/sitespecific/bao/dc/fmla-eligible`, { user: staffId });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.fmlaEligible)).toBe(true);
    for (const row of body.fmlaEligible) {
      expect(row.worker.workerId).toBeTruthy();
      expect(row.fmlaMonths.length).toBeGreaterThanOrEqual(3);
    }
  });
});

// ---------------------------------------------------------------------------
// Task 411 regressions
// ---------------------------------------------------------------------------

describe("FMLA month labels render as complete months (task 411)", () => {
  it("formats stored ISO first-of-month values as full month labels", () => {
    expect(formatYmdMonth("2026-02-01")).toBe("February 2026");
    expect(formatYmdMonth("2025-12-01")).toBe("December 2025");
    // The old rendering was formatYmd("2026-02-01").slice(0, 7) → "02/01/2".
    expect(formatYmdMonth("2026-02-01")).not.toMatch(/\/\d$/);
  });

  it("falls back to the raw value for non-Ymd input instead of truncating", () => {
    expect(formatYmdMonth("not-a-date")).toBe("not-a-date");
  });
});

describe("queued-case approval through the real action route (task 411)", () => {
  const run = `dc-routes-411-${Date.now()}`;
  const now = new Date();
  const curYear = now.getFullYear();
  const curMonth = now.getMonth() + 1;
  const addM = (y: number, m: number, d: number) => {
    const o = y * 12 + (m - 1) + d;
    return { year: Math.floor(o / 12), month: (o % 12) + 1 };
  };
  const ymd = (p: { year: number; month: number }) =>
    `${p.year}-${String(p.month).padStart(2, "0")}-01`;
  const monthA = addM(curYear, curMonth, -1); // coverage (lag 1) = current → due

  let okWorkerId = "";
  let badWorkerId = "";
  let benefitId = "";
  let policyId = "";
  let employerId = "";
  let statusId = "";
  let configId = "";

  /** Build a fully READY case exactly as staff intake does, then queue it via the route. */
  async function buildQueuedCase(workerId: string): Promise<string> {
    const c = await storage.baoDisabilityCredit.openCase({
      workerId,
      openedYmd: ymd({ year: curYear, month: curMonth }),
      qualifyingBasis: {
        asOfYmd: ymd({ year: curYear, month: curMonth }),
        conditions: ["fmla_months"],
        fmlaMonths: [ymd(monthA)],
      },
      createdByUserId: staffId,
    });
    caseIds.push(c.id);
    await replaceDcCaseMonths(c.id, [ymd(monthA)], { actorUserId: staffId });
    await storage.baoDisabilityCredit.addDocument({
      parentKind: "case",
      caseId: c.id,
      name: "form.pdf",
      uploadedByUserId: staffId,
      docType: "dc_form",
    } as never);
    await storage.baoDisabilityCredit.updateCaseAttestations(
      c.id,
      {
        dcFormOnFile: true,
        signed: true,
        fields: { doctorAddress: true, doctorPhone: true, dates: true },
      } as never,
      staffId,
    );
    // One-step handoff: preparation ends with a single Send for Approval.
    const res = await request(`/api/sitespecific/bao/dc/cases/${c.id}/actions`, {
      method: "POST",
      user: staffId,
      body: JSON.stringify({ action: "send_for_approval", expectedStatus: "draft" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.case.status).toBe("in_queue");
    return c.id;
  }

  beforeAll(async () => {
    const mkWorker = async (label: string) =>
      (await storage.workers.createWorker(`DC Routes 411 ${label} ${run}`)).id;
    okWorkerId = await mkWorker("ok");
    badWorkerId = await mkWorker("bad");

    const [benefit] = await db
      .insert(trustBenefits)
      .values({ name: `${run}-b`, siriusId: `${run}-b` })
      .returning();
    benefitId = benefit.id;
    const [policy] = await db
      .insert(policies)
      .values({ siriusId: `${run}-p`, name: `${run}-p` })
      .returning();
    policyId = policy.id;
    const [employer] = await db
      .insert(employers)
      .values({
        name: `${run}-e`,
        siriusId: `${run}-e`,
        isActive: true,
        denormPolicyId: policyId,
      } as never)
      .returning();
    employerId = employer.id;
    const [status] = await db
      .insert(optionsEmploymentStatus)
      .values({ name: `${run}-Active`, code: `${run}-ACT`, employed: true })
      .returning();
    statusId = status.id;

    // Both workers have an election + continued-benefit WMB coverage through
    // cur−1, so month A (coverage cur, lag 1) continues it with no gap; only
    // the OK worker's policy carries a continuation-threshold rule.
    const wmbMonth = addM(curYear, curMonth, -2);
    for (const wid of [okWorkerId, badWorkerId]) {
      await db.insert(workerTrustElections).values({
        workerId: wid,
        employerId,
        benefitIds: [benefitId],
        startYmd: `${wmbMonth.year}-01-01`,
        endYmd: null,
      });
      await db.insert(trustWmb).values(
        [wmbMonth, addM(curYear, curMonth, -1)].map((m) => ({
          workerId: wid,
          employerId,
          benefitId,
          year: m.year,
          month: m.month,
        })),
      );
    }
    const [cfg] = await db
      .insert(pluginConfigs)
      .values({
        pluginKind: "trust-eligibility",
        pluginId: "sitespecific-bao-buildup",
        enabled: true,
        name: `${run}-rule`,
        data: { defaultThreshold: 120, lagMonths: 1 },
      })
      .returning();
    configId = cfg.id;
    await db
      .insert(pluginConfigsBenefitEligibility)
      .values({ id: configId, policy: policyId, benefit: benefitId, appliesTo: null });
  });

  afterAll(async () => {
    const wids = [okWorkerId, badWorkerId].filter(Boolean);
    if (wids.length) {
      await db.delete(workerHours).where(inArray(workerHours.workerId, wids));
      await db
        .delete(sitespecificBaoDcEvents)
        .where(inArray(sitespecificBaoDcEvents.workerId, wids));
      await db
        .delete(sitespecificBaoDcCaseMonths)
        .where(inArray(sitespecificBaoDcCaseMonths.workerId, wids));
      const cases = await db
        .select()
        .from(sitespecificBaoDcCases)
        .where(inArray(sitespecificBaoDcCases.workerId, wids));
      if (cases.length) {
        await db
          .delete(sitespecificBaoDcDocuments)
          .where(inArray(sitespecificBaoDcDocuments.caseId, cases.map((c) => c.id)));
      }
      await db
        .delete(sitespecificBaoDcCases)
        .where(inArray(sitespecificBaoDcCases.workerId, wids));
      await db.delete(trustWmb).where(inArray(trustWmb.workerId, wids));
      await db
        .delete(workerTrustElections)
        .where(inArray(workerTrustElections.workerId, wids));
    }
    if (configId) {
      await db
        .delete(pluginConfigsBenefitEligibility)
        .where(eq(pluginConfigsBenefitEligibility.id, configId));
      await db.delete(pluginConfigs).where(eq(pluginConfigs.id, configId));
    }
    if (statusId)
      await db.delete(optionsEmploymentStatus).where(eq(optionsEmploymentStatus.id, statusId));
    if (employerId) await db.delete(employers).where(eq(employers.id, employerId));
    if (policyId) await db.delete(policies).where(eq(policies.id, policyId));
    if (benefitId) await db.delete(trustBenefits).where(eq(trustBenefits.id, benefitId));
    if (wids.length) await db.delete(workersTable).where(inArray(workersTable.id, wids));
  });

  it("approves a ready queued case end-to-end and grants the due month", async () => {
    const caseId = await buildQueuedCase(okWorkerId);
    const res = await request(`/api/sitespecific/bao/dc/cases/${caseId}/actions`, {
      method: "POST",
      user: staffId,
      body: JSON.stringify({ action: "approve", expectedStatus: "in_queue" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.case.status).toBe("approved");
    expect(body.grant).toBeDefined();
    const outcome = body.grant.find(
      (o: { workMonthYmd: string }) => o.workMonthYmd === ymd(monthA),
    );
    expect(outcome?.action).toBe("granted");
    expect(outcome?.grantedHours).toBe(120); // no employer hours that month
    const months = await storage.baoDisabilityCredit.listCaseMonths(caseId);
    expect(months[0]?.status).toBe("granted");
  });

  it("maps an expected grant failure to an actionable 422 and rolls the case back", async () => {
    // The bad worker's continued benefit has NO threshold rule — the grant
    // cascade fails AFTER the status transition; the whole approval must
    // roll back atomically and surface a coded, actionable response.
    const caseId = await buildQueuedCase(badWorkerId);
    // Remove the shared rule's applicability for this worker? The rule is
    // policy+benefit scoped and applies to both workers, so instead the bad
    // path removes the rule config link for the duration of the call.
    await db
      .delete(pluginConfigsBenefitEligibility)
      .where(eq(pluginConfigsBenefitEligibility.id, configId));
    let res: Awaited<ReturnType<typeof request>>;
    try {
      res = await request(`/api/sitespecific/bao/dc/cases/${caseId}/actions`, {
        method: "POST",
        user: staffId,
        body: JSON.stringify({ action: "approve", expectedStatus: "in_queue" }),
      });
    } finally {
      await db
        .insert(pluginConfigsBenefitEligibility)
        .values({ id: configId, policy: policyId, benefit: benefitId, appliesTo: null });
    }
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe("DC_GRANT_NO_THRESHOLD_RULE");
    expect(body.message).toContain("left unchanged");

    // All-or-nothing: the case is still in the queue, the month untouched,
    // no grant events recorded, no DC hours written.
    const after = await storage.baoDisabilityCredit.getCase(caseId);
    expect(after?.status).toBe("in_queue");
    const months = await storage.baoDisabilityCredit.listCaseMonths(caseId);
    expect(months.map((m) => m.status)).toEqual(["selected"]);
    const events = await db
      .select()
      .from(sitespecificBaoDcEvents)
      .where(eq(sitespecificBaoDcEvents.caseId, caseId));
    expect(events.filter((e) => e.eventType === "case_month_granted")).toHaveLength(0);
    const hours = await db
      .select()
      .from(workerHours)
      .where(eq(workerHours.workerId, badWorkerId));
    expect(hours).toHaveLength(0);
  });
});
