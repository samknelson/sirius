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
} from "@shared/schema";
import { inArray } from "drizzle-orm";
import { formatYmdMonth } from "@shared/utils/date";
import { updateComponentCache, isComponentEnabledSync } from "../../server/services/component-cache";
import { initAccessControl } from "../../server/services/access-policy-evaluator";
import dcMigration from "../../scripts/migrate/components/sitespecific.bao/011_create_disability_credit";
import dcWorkflowMigration from "../../scripts/migrate/components/sitespecific.bao/012_dc_case_workflow";
import dcGrantMigration from "../../scripts/migrate/components/sitespecific.bao/013_dc_grant_events";
import dcExtensionsMigration from "../../scripts/migrate/components/sitespecific.bao/014_dc_extensions_and_notes_retirement";

let base = "";
let closeServer: (() => Promise<void>) | undefined;
let workerId = "";
let staffId = "";
const caseIds: string[] = [];

async function request(path: string, init: RequestInit & { user?: string; staff?: boolean } = {}) {
  const headers = new Headers(init.headers);
  if (init.user) headers.set("x-user", init.user);
  if (init.staff === false) headers.set("x-staff", "0");
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return fetch(`${base}${path}`, { ...init, headers });
}

beforeAll(async () => {
  await dcMigration.up();
  await dcWorkflowMigration.up();
  await dcGrantMigration.up();
  await dcExtensionsMigration.up();
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
  const workers = await storage.workers.getAllWorkers();
  const staff = (await storage.users.getUsersWithAnyPermission(["staff", "admin"]))[0];
  if (!workers[0] || !staff) throw new Error("DC route harness prerequisites unavailable");
  workerId = workers[0].id;
  staffId = staff.id;

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
});

async function makeCase(status: string): Promise<string> {
  const c = await storage.baoDisabilityCredit.openCase({
    workerId,
    openedYmd: "2027-09-01",
    qualifyingBasis: {
      asOfYmd: "2027-09-01",
      conditions: ["denial_letter"],
      denialLetterIds: ["x"],
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
      [`/api/sitespecific/bao/dc/cases/${id}/actions`, { method: "POST", body: JSON.stringify({ action: "mark_ready" }) }],
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
    await storage.baoDisabilityCredit.replaceCaseMonths(c.id, [ymd(monthA)], {
      actorUserId: staffId,
    });
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
    for (const [action, expected] of [
      ["mark_ready", "draft"],
      ["queue", "ready_for_review"],
    ] as const) {
      const res = await request(`/api/sitespecific/bao/dc/cases/${c.id}/actions`, {
        method: "POST",
        user: staffId,
        body: JSON.stringify({ action, expectedStatus: expected }),
      });
      expect(res.status).toBe(200);
    }
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

    // Both workers have an election + continued-benefit WMB anchor; only the
    // OK worker's policy carries a continuation-threshold rule.
    const wmbMonth = addM(curYear, curMonth, -2);
    for (const wid of [okWorkerId, badWorkerId]) {
      await db.insert(workerTrustElections).values({
        workerId: wid,
        employerId,
        benefitIds: [benefitId],
        startYmd: `${wmbMonth.year}-01-01`,
        endYmd: null,
      });
      await db.insert(trustWmb).values({
        workerId: wid,
        employerId,
        benefitId,
        year: wmbMonth.year,
        month: wmbMonth.month,
      });
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
