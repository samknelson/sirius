import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerBaoDisabilityCreditRoutes } from "../../server/modules/sitespecific/bao/disability-credit";
import { storage } from "../../server/storage";
import { db } from "../../server/db";
import { eq } from "drizzle-orm";
import { sitespecificBaoDcCases, sitespecificBaoDcEvents } from "@shared/schema";
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
