import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PolicyContext } from "../../shared/access-policies";
import createPolicy from "../../shared/access-policies/edls/sheet/create";
import editPolicy from "../../shared/access-policies/edls/sheet/edit";
import assignPolicy from "../../shared/access-policies/edls/sheet/assign";
import statusPolicy from "../../shared/access-policies/edls/sheet/set-status";
import managePolicy from "../../shared/access-policies/edls/sheet/manage";
import copyPolicy from "../../shared/access-policies/edls/sheet/copy";
import { edlsSheetStatusEnum, insertEdlsSheetsSchema } from "../../shared/schema";

const mocks = vi.hoisted(() => ({
  sheet: {} as Record<string, any>,
  permissions: ["edls.supervisor"],
  componentEnabled: true,
  effectiveUserId: "supervisor",
  create: vi.fn(),
  update: vi.fn(),
  get: vi.fn(),
  getWithRelations: vi.fn(),
  getCrews: vi.fn(),
  assignments: vi.fn(),
  createAssignment: vi.fn(),
  supervisorContext: vi.fn(),
  validateSupervisor: vi.fn(),
}));

vi.mock("../../server/storage", () => ({
  storage: {
    edlsSheets: {
      create: mocks.create, update: mocks.update, get: mocks.get,
      getWithRelations: mocks.getWithRelations,
    },
    employers: { getEmployer: vi.fn(async () => ({ id: "employer" })) },
    edlsCrews: {
      getCrewsTotalWorkerCount: vi.fn(async () => 1),
      getBySheetId: mocks.getCrews,
    },
    edlsAssignments: { getBySheetId: mocks.assignments, create: mocks.createAssignment },
  },
}));
vi.mock("../../server/modules/masquerade", () => ({
  getEffectiveUser: async () => ({ dbUser: { id: mocks.effectiveUserId } }),
}));
vi.mock("../../server/modules/edls/supervisor-context", () => ({
  getEdlsSettings: async () => ({ employer: "employer" }),
  getSupervisorContext: mocks.supervisorContext,
  validateSupervisorForSave: mocks.validateSupervisor,
}));
vi.mock("../../server/services/component/cache", () => ({
  isComponentEnabledSync: () => mocks.componentEnabled,
}));
vi.mock("../../server/modules/components", () => ({
  requireComponent: () => (_req: any, res: any, next: () => void) =>
    mocks.componentEnabled ? next() : res.status(403).json({ message: "Component disabled" }),
}));
vi.mock("../../server/services/access-policy-evaluator", () => ({
  // Exercise the route's actual policy selection and target-status projection
  // against the real policy evaluators, with no DB, server or auth session.
  requireAccess: (id: string, options?: any) => async (req: any, res: any, next: () => void) => {
    const policies = {
      "edls.sheet.create": createPolicy,
      "edls.sheet.edit": editPolicy,
      "edls.sheet.assign": assignPolicy,
      "edls.sheet.set_status": statusPolicy,
      "edls.sheet.manage": managePolicy,
      "edls.sheet.copy": copyPolicy,
    };
    const policy = policies[id as keyof typeof policies];
    if (!policy) throw new Error(`Unexpected policy: ${id}`);
    const ctx = {
      user: { id: mocks.effectiveUserId },
      entityId: typeof options === "function" ? options(req) : options?.getEntityId?.(req),
      entityData: options?.getEntityData?.(req),
      loadEntity: async () => mocks.sheet,
      hasPermission: async (permission: string) => mocks.permissions.includes(permission),
      hasAnyPermission: async (permissions: string[]) => permissions.some(p => mocks.permissions.includes(p)),
      checkPolicy: async (policyId: keyof typeof policies, entityId?: string) => {
        const delegated = policies[policyId];
        if (!delegated) throw new Error(`Unexpected policy: ${policyId}`);
        return (await delegated.evaluate!({ ...ctx, entityId })).granted;
      },
    } as unknown as PolicyContext;
    const result = await policy.evaluate!(ctx);
    if (result.granted) next();
    else res.status(403).json({ message: result.reason });
  },
}));

import { registerEdlsSheetsRoutes } from "../../server/modules/edls/sheets";

type Handler = (req: any, res: any, next: () => void) => unknown;
const routes = new Map<string, Handler[]>();
beforeAll(() => {
  const app = Object.fromEntries(["get", "post", "put", "patch", "delete"].map(verb => [
    verb, (path: string, ...handlers: Handler[]) => routes.set(`${verb} ${path}`, handlers),
  ]));
  registerEdlsSheetsRoutes(app as any, (_req: any, _res: any, next: () => void) => next(), vi.fn());
});

const crew = {
  title: "Crew", workerCount: 1, startTime: "08:00", endTime: "17:00",
  supervisor: "supervisor", taskId: null, location: "", data: { extension: "crew-owned" },
};
const form = {
  title: "Job", ymd: "2026-10-31", departmentId: "department", workerCount: 1,
  supervisor: "supervisor", assignee: "", jobGroupId: "", facilityId: "",
  showStatusId: "", notes: "", crews: [crew],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.permissions = ["edls.supervisor"];
  mocks.componentEnabled = true;
  mocks.effectiveUserId = "supervisor";
  mocks.sheet = {
    id: "sheet", ...form, employerId: "employer", status: "draft",
    data: { trashLock: true, extension: { keep: ["all", "values"] } },
    notificationsEnabled: true,
  };
  mocks.get.mockImplementation(async () => mocks.sheet);
  mocks.getWithRelations.mockImplementation(async () => mocks.sheet);
  mocks.getCrews.mockResolvedValue([{ id: "crew", sheetId: "sheet", ...crew, sequence: 0 }]);
  mocks.assignments.mockResolvedValue([]);
  mocks.createAssignment.mockResolvedValue({ id: "new-assignment" });
  mocks.create.mockImplementation(async (sheet, crews) => ({ id: "copy", ...sheet, crews }));
  mocks.update.mockImplementation(async (_id, patch, crews) => {
    // Same partial-update semantics as storage: absent fields remain untouched.
    const defined = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
    mocks.sheet = { ...mocks.sheet, ...defined };
    return { ...mocks.sheet, crews: crews ?? [crew] };
  });
  mocks.supervisorContext.mockResolvedValue({
    canManage: false, options: [{ id: "supervisor" }],
  });
  mocks.validateSupervisor.mockReturnValue({ valid: true, supervisorId: "supervisor" });
});

async function request(verb: string, body: unknown, suffix = verb === "post" ? "" : "/:id") {
  const result = { status: 200, body: undefined as any };
  const res = {
    status(code: number) { result.status = code; return res; },
    json(value: unknown) { result.body = value; return res; },
  };
  const handlers = routes.get(`${verb} /api/edls/sheets${suffix}`)!;
  const req = { body, params: { id: "sheet" }, user: { id: "real-user" }, session: {} };
  for (let i = 0; i < handlers.length; i++) {
    let continued = false;
    await handlers[i](req, res, () => { continued = true; });
    if (i < handlers.length - 1 && !continued) break;
  }
  return result;
}

function expectNoSave() {
  // All sheet/crew mutations, assignment release and status notifications
  // start inside these save operations. No save means none can be triggered.
  expect(mocks.create).not.toHaveBeenCalled();
  expect(mocks.update).not.toHaveBeenCalled();
  expect(mocks.getCrews).not.toHaveBeenCalled();
  expect(mocks.assignments).not.toHaveBeenCalled();
  expect(mocks.createAssignment).not.toHaveBeenCalled();
}

describe("ordinary EDLS HTTP write boundary", () => {
  const protectedPayloads = [
    { status: "lock" }, { status: "trash" }, { status: "unknown" },
    { data: { trashLock: false } }, { data: null }, { notificationsEnabled: false },
    { status: "trash", data: { trashLock: false }, notificationsEnabled: false },
    { employerId: "other" }, { changed: "2026-01-01" }, { id: "other" },
  ];
  it.each(protectedPayloads)("refuses supervisor edits containing %j before any save", async payload => {
    const before = structuredClone(mocks.sheet);
    const result = await request("put", { title: "Legitimate edit", crews: [{ id: "crew", ...crew }], ...payload });
    expect(result.status).toBe(400);
    expect(result.body.errors.formErrors.join(" ")).toContain("Unrecognized key");
    expectNoSave();
    expect(mocks.supervisorContext).not.toHaveBeenCalled();
    expect(mocks.sheet).toEqual(before);
  });

  it.each(protectedPayloads)("refuses advisor creation containing %j", async payload => {
    mocks.permissions = ["edls.worker.advisor"];
    expect((await request("post", { ...form, ...payload })).status).toBe(400);
    expectNoSave();
    expect(mocks.supervisorContext).not.toHaveBeenCalled();
  });

  it("creates an advisor's valid sheet explicitly as draft with effective-user supervisor validation", async () => {
    mocks.permissions = ["edls.worker.advisor"];
    mocks.effectiveUserId = "masqueraded-advisor";
    expect((await request("post", form)).status).toBe(201);
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ status: "draft", employerId: "employer" }), [crew]);
    const input = mocks.create.mock.calls[0][0];
    expect(input).not.toHaveProperty("data");
    expect(input).not.toHaveProperty("notificationsEnabled");
    expect(mocks.supervisorContext).toHaveBeenCalledWith("masqueraded-advisor");
    expect(mocks.validateSupervisor).toHaveBeenCalledWith(expect.anything(), "supervisor", "masqueraded-advisor");
  });

  it.each([false, true])("preserves status, trash lock, extension JSON and notifications in a valid save; crews=%s", async withCrews => {
    const data = mocks.sheet.data;
    const result = await request("put", withCrews ? { ...form, crews: [{ id: "crew", ...crew }] } : { title: "Updated" });
    expect(result.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledOnce();
    const patch = mocks.update.mock.calls[0][1];
    for (const key of ["status", "data", "notificationsEnabled"]) expect(patch).not.toHaveProperty(key);
    expect(mocks.sheet.status).toBe("draft");
    expect(mocks.sheet.data).toBe(data);
    expect(mocks.sheet.notificationsEnabled).toBe(true);
    if (withCrews) expect(mocks.update.mock.calls[0][2]).toEqual([{ id: "crew", ...crew }]);
  });

  it.each(["lock", "trash"])("continues refusing ordinary edits of %s sheets", async status => {
    mocks.permissions = ["edls.manager"];
    mocks.sheet.status = status;
    expect((await request("put", { title: "Updated" })).status).toBe(403);
    expectNoSave();
  });

  it("retains supervisor validation and crew count checks", async () => {
    mocks.validateSupervisor.mockReturnValue({ valid: false, error: "Invalid supervisor" });
    expect((await request("put", form)).status).toBe(403);
    expectNoSave();
    mocks.validateSupervisor.mockReturnValue({ valid: true, supervisorId: "supervisor" });
    expect((await request("put", { ...form, workerCount: 2 })).status).toBe(400);
    expectNoSave();
  });

  it("retains EDLS component gating", async () => {
    mocks.componentEnabled = false;
    expect((await request("put", { title: "Updated" })).status).toBe(403);
    expectNoSave();
  });
});

describe("dedicated EDLS actions and trusted inputs", () => {
  it.each(["admin", "edls.manager", "edls.coordinator"])("accepts the shared status enum for %s", async permission => {
    mocks.permissions = [permission];
    for (const status of edlsSheetStatusEnum) {
      mocks.sheet.status = "draft";
      mocks.sheet.data = { trashLock: false };
      expect((await request("patch", { status }, "/:id/status")).status).toBe(200);
      expect(mocks.update).toHaveBeenLastCalledWith("sheet", { status });
    }
  });

  it.each(["bogus", "", null, 42])("rejects invalid dedicated status %j without saving", async status => {
    mocks.permissions = ["edls.manager"];
    expect((await request("patch", { status }, "/:id/status")).status).toBe(400);
    expectNoSave();
  });

  it.each([
    ["edls.supervisor", "draft", "lock", false],
    ["edls.worker.advisor", "draft", "lock", false],
    ["edls.worker.advisor", "lock", "request", false],
    ["admin", "lock", "trash", false],
    ["edls.manager", "draft", "trash", true],
  ])("refuses %s %s→%s with trash lock=%s", async (permission, current, target, trashLock) => {
    mocks.permissions = [permission as string];
    mocks.sheet.status = current;
    mocks.sheet.data.trashLock = trashLock;
    expect((await request("patch", { status: target }, "/:id/status")).status).toBe(403);
    expectNoSave();
  });

  it("allows an advisor's non-Scheduled transition", async () => {
    mocks.permissions = ["edls.worker.advisor"];
    expect((await request("patch", { status: "request" }, "/:id/status")).status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith("sheet", { status: "request" });
  });

  it("keeps trash-lock and notification writes on their own actions", async () => {
    const extension = mocks.sheet.data.extension;
    expect((await request("patch", { trashLock: false }, "/:id/trash-lock")).status).toBe(200);
    expect(mocks.sheet.data).toEqual({ trashLock: false, extension });
    expect((await request("patch", { notificationsEnabled: false }, "/:id/notifications-enabled")).status).toBe(200);
    expect(mocks.update).toHaveBeenLastCalledWith("sheet", { notificationsEnabled: false });
  });

  it.each(["lock", "trash"])("refuses dedicated protection and notification edits on %s", async status => {
    mocks.permissions = ["edls.manager"];
    mocks.sheet.status = status;
    expect((await request("patch", { trashLock: false }, "/:id/trash-lock")).status).toBe(403);
    expect((await request("patch", { notificationsEnabled: false }, "/:id/notifications-enabled")).status).toBe(403);
    expectNoSave();
  });

  it.each([
    { jobGroupId: "job-group", facilityId: "facility", showStatusId: "show-status", notes: "Keep these notes\nand this line" },
    { jobGroupId: null, facilityId: null, showStatusId: null, notes: null },
    { jobGroupId: "", facilityId: "", showStatusId: "", notes: "" },
  ])("copies ordinary sheet and crew values unchanged: %j", async fields => {
    mocks.permissions = ["edls.manager"];
    Object.assign(mocks.sheet, fields, { status: "lock", changed: new Date("2026-10-01") });
    const sourceCrews = [
      { id: "crew-a", sheetId: "sheet", ...crew, taskId: "task", location: "Dock", sequence: 0,
        data: { nested: { values: [null, "", false, 0, { code: "keep" }] } } },
      { id: "crew-b", sheetId: "sheet", ...crew, sequence: 1, data: null },
      { id: "crew-c", sheetId: "sheet", ...crew, sequence: 2, data: {} },
    ];
    mocks.sheet.workerCount = 3;
    mocks.getCrews.mockResolvedValue(sourceCrews);
    const before = structuredClone(mocks.sheet);
    const result = await request("post", { targetDate: "2026-11-01" }, "/:id/copy");
    expect(result.status).toBe(201);
    expect(result.body).toEqual({ newSheetId: "copy", successCount: 0, failedAssignments: [] });
    expect(mocks.create).toHaveBeenCalledExactlyOnceWith({
      ymd: "2026-11-01", title: before.title, workerCount: 3,
      departmentId: before.departmentId, employerId: before.employerId,
      supervisor: before.supervisor, assignee: before.assignee, ...fields,
      status: "draft", data: { extension: before.data.extension },
    }, sourceCrews.map(({ id, sheetId, ...values }) => values));
    // Exact input assertions exclude old identities, watermark and notification opt-in.
    expect(mocks.sheet).toEqual(before);
  });

  it("maps workers to fresh crews and reports conflicts and unmatched crews without losing other assignments", async () => {
    mocks.permissions = ["edls.coordinator"];
    const sourceCrews = [
      { id: "old-a", sheetId: "sheet", ...crew, sequence: 0 },
      { id: "old-b", sheetId: "sheet", ...crew, sequence: 1 },
    ];
    // Return new crews in the opposite order so mapping must use sequence.
    mocks.getCrews.mockResolvedValueOnce(sourceCrews).mockResolvedValueOnce([
      { ...sourceCrews[1], id: "new-b", sheetId: "copy" },
      { ...sourceCrews[0], id: "new-a", sheetId: "copy" },
    ]);
    const data = { classificationId: "classification", nested: { keep: [false, null, ""] } };
    mocks.assignments.mockResolvedValue([
      { id: "answer-yes", crewId: "old-b", workerId: "worker-b", data,
        ymd: form.ymd, accepted: true, commId: "receipt-b", generationId: "old-generation-b" },
      { id: "conflict", crewId: "old-a", workerId: "busy", data: {},
        worker: { family: "Busy", given: "Worker" } },
      { id: "unmatched", crewId: "missing", workerId: "unmatched", data: null,
        worker: { displayName: "Unmatched Worker" } },
      { id: "answer-no", crewId: "old-a", workerId: "worker-a", data: null,
        accepted: false, commId: "receipt-a", generationId: "old-generation-a" },
    ]);
    mocks.createAssignment.mockResolvedValueOnce({ id: "fresh-b" })
      .mockRejectedValueOnce(new Error("Worker already assigned on target date"))
      .mockResolvedValueOnce({ id: "fresh-a" });
    const result = await request("post", { targetDate: "2026-11-01" }, "/:id/copy");
    expect(result.status).toBe(201);
    // Only assignment input survives: answers, receipts, IDs and generations are storage-owned.
    expect(mocks.createAssignment.mock.calls).toEqual([
      [{ ymd: "2026-11-01", crewId: "new-b", workerId: "worker-b", data }],
      [{ ymd: "2026-11-01", crewId: "new-a", workerId: "busy", data: {} }],
      [{ ymd: "2026-11-01", crewId: "new-a", workerId: "worker-a", data: null }],
    ]);
    expect(result.body).toEqual({
      newSheetId: "copy", successCount: 2,
      failedAssignments: [
        { workerId: "busy", workerName: "Busy, Worker", reason: "Worker already assigned on target date" },
        { workerId: "unmatched", workerName: "Unmatched Worker", reason: "Could not find matching crew in new sheet" },
      ],
    });
  });

  it.each([
    ["admin", "lock", "other", 201],
    ["edls.manager", "lock", "other", 201],
    ["edls.coordinator", "lock", "other", 201],
    ["edls.worker.advisor", "draft", "other", 201],
    ["edls.worker.advisor", "lock", "other", 403],
    ["edls.supervisor", "lock", "supervisor", 201],
    ["edls.supervisor", "draft", "other", 403],
    ["unrelated", "draft", "supervisor", 403],
  ])("retains copy access for %s on %s supervised by %s", async (permission, status, supervisor, expected) => {
    mocks.permissions = [permission as string];
    Object.assign(mocks.sheet, { status, supervisor });
    expect((await request("post", { targetDate: "2026-11-01" }, "/:id/copy")).status).toBe(expected);
    if (expected === 403) expectNoSave();
  });

  it.each([form.ymd, "11/01/2026", "", null])("refuses an unchanged or malformed copy date %j", async targetDate => {
    expect((await request("post", { targetDate }, "/:id/copy")).status).toBe(400);
    expectNoSave();
  });

  it("retains component gating for copies", async () => {
    mocks.componentEnabled = false;
    expect((await request("post", { targetDate: "2026-11-01" }, "/:id/copy")).status).toBe(403);
    expectNoSave();
  });

  it("keeps the shared trusted insert schema capable of status and application data writes", () => {
    for (const status of edlsSheetStatusEnum) {
      const parsed = insertEdlsSheetsSchema.parse({ ...form, employerId: "employer", status, data: mocks.sheet.data });
      expect(parsed.status).toBe(status);
      expect(parsed.data).toEqual(mocks.sheet.data);
    }
  });
});
