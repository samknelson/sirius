import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { list, getWorkerAssignmentDetails, getEmployer, getByName, componentState, accessDecision, sheetAccess } = vi.hoisted(() => ({
  list: vi.fn(),
  getWorkerAssignmentDetails: vi.fn(),
  getEmployer: vi.fn(),
  getByName: vi.fn(),
  componentState: { enabled: true },
  accessDecision: { granted: true },
  sheetAccess: new Map<string, boolean>(),
}));

vi.mock("../../server/storage", () => ({
  storage: {
    edlsWorkerDirectory: { list },
    edlsAssignments: { getWorkerAssignmentDetails },
    employers: { getEmployer },
    variables: { getByName },
  },
}));

vi.mock("../../server/services/component-cache", () => ({
  isCacheInitialized: () => true,
  loadComponentCache: vi.fn(),
  isComponentEnabledSync: () => componentState.enabled,
}));
vi.mock("@shared/components", () => ({
  getAllComponents: () => [],
  getComponentById: (id: string) => ({ id, name: id }),
}));
vi.mock("../../server/services/component-lifecycle", () => ({
  enableComponentSchema: vi.fn(),
  disableComponentSchema: vi.fn(),
  repairComponentSchema: vi.fn(),
  reconcileComponentPluginConfigs: vi.fn(),
  checkComponentSchemaDrift: vi.fn(),
  getComponentSchemaInfo: vi.fn(),
}));
vi.mock("../../server/services/component-permissions", () => ({ syncComponentPermissions: vi.fn() }));
vi.mock("../../server/services/access-policy-evaluator", () => ({
  requireAccess: () => (_req: any, res: any, next: () => void) => {
    if (accessDecision.granted) return next();
    res.status(403).json({ message: "Access denied" });
  },
  checkAccessInline: vi.fn(async (_req: any, _policyId: string, sheetId: string) => ({
    granted: sheetAccess.get(sheetId) ?? false,
  })),
}));
vi.mock("../../server/modules/edls/supervisor-context", () => ({
  getEdlsSettings: vi.fn(async () => ({ employer: "employer-1" })),
}));

import { registerWorkerEdlsRoutes } from "../../server/modules/edls/workers";

let middleware: Array<(req: any, res: any, next: () => void) => Promise<void> | void>;
let handler: (req: any, res: any) => Promise<void>;
let assignmentDetailsMiddleware: typeof middleware;
let assignmentDetailsHandler: typeof handler;

beforeAll(() => {
  registerWorkerEdlsRoutes({
    get(path: string, ...args: unknown[]) {
      if (path === "/api/edls/workers") {
        middleware = args.slice(0, -1) as typeof middleware;
        handler = args.at(-1) as typeof handler;
      }
      if (path === "/api/edls/workers/:id/assignment-details") {
        assignmentDetailsMiddleware = args.slice(0, -1) as typeof middleware;
        assignmentDetailsHandler = args.at(-1) as typeof handler;
      }
    },
    put() {},
  } as any, ((req: any, res: any, next: () => void) => {
    if (req.user) return next();
    res.status(401).json({ message: "Unauthorized" });
  }) as any);
});

beforeEach(() => {
  componentState.enabled = true;
  accessDecision.granted = true;
  list.mockClear();
  getWorkerAssignmentDetails.mockReset();
  sheetAccess.clear();
  getByName.mockResolvedValue({ value: { employer: "employer-1" } });
  getEmployer.mockResolvedValue({ industryId: "industry-1" });
  list.mockResolvedValue({ rows: [], total: 0, page: 1, pageSize: 50, totalPages: 0, idTypes: [] });
  getWorkerAssignmentDetails.mockResolvedValue({
    workerId: "worker-1",
    siriusId: 123,
    displayName: "Ada Worker",
    given: "Ada",
    family: "Worker",
    prior: { sheetId: "sheet-prior", sheetName: "Prior", sheetYmd: "2026-01-01", sheetStatus: "lock", crewId: "crew-prior", crewName: "Crew", startTime: null, endTime: null, supervisorName: null },
    current: { sheetId: "sheet-current", sheetName: "Current", sheetYmd: "2026-01-02", sheetStatus: "lock", crewId: "crew-current", crewName: "Crew", startTime: null, endTime: null, supervisorName: null },
    next: null,
  });
});

async function request(query: Record<string, string> = {}, authenticated = true) {
  const result: { status: number; body?: any } = { status: 200 };
  const res = {
    status(code: number) { result.status = code; return res; },
    json(body: unknown) { result.body = body; return res; },
  };
  const req: any = { query };
  if (authenticated) req.user = { claims: { sub: "user-1" } };
  for (const step of middleware) {
    let nextCalled = false;
    await step(req, res, () => { nextCalled = true; });
    if (!nextCalled) return result;
  }
  await handler(req, res);
  return result;
}

async function requestAssignmentDetails(authenticated = true, query: Record<string, string> = {}) {
  const result: { status: number; body?: any } = { status: 200 };
  const res = {
    status(code: number) {
      result.status = code;
      return res;
    },
    json(body: unknown) {
      result.body = body;
      return res;
    },
  };
  const req: any = { params: { id: "worker-1" }, query };
  if (authenticated) req.user = { claims: { sub: "user-1" } };

  for (const step of assignmentDetailsMiddleware) {
    let nextCalled = false;
    await step(req, res, () => { nextCalled = true; });
    if (!nextCalled) return result;
  }
  await assignmentDetailsHandler(req, res);
  return result;
}

describe("GET /api/edls/workers", () => {
  it("passes filters, EDLS industry, and local date to EDLS storage", async () => {
    const result = await request({
      page: "2",
      pageSize: "25",
      name: "Ada",
      active: "true",
      memberStatusId: "status-1",
      idTypeId: "id-type-1",
      idValue: "123",
      ratingId: "rating-1",
      ratingValue: "4",
      referenceDate: "2026-03-15",
      currentAssignment: "include",
      nextAssignment: "exclude",
    });

    expect(result.status).toBe(200);
    expect(list).toHaveBeenCalledWith(expect.objectContaining({
      page: 2,
      pageSize: 25,
      name: "Ada",
      active: true,
      memberStatusId: "status-1",
      idTypeId: "id-type-1",
      idValue: "123",
      ratingId: "rating-1",
      ratingValue: 4,
      industryId: "industry-1",
      referenceYmd: "2026-03-15",
      currentAssignment: "include",
      nextAssignment: "exclude",
    }));
  });

  it("omits the member-status filter and reports no industry when EDLS has no configured industry", async () => {
    getEmployer.mockResolvedValueOnce(undefined);
    const result = await request({ memberStatusId: "status-1" });

    expect(result.status).toBe(200);
    expect(list).toHaveBeenCalledWith(expect.objectContaining({
      industryId: null,
      memberStatusId: undefined,
    }));
    expect(result.body).toEqual(expect.objectContaining({ industryId: null }));
  });

  it("requires authentication, the EDLS component, and edls.any", async () => {
    expect((await request({}, false)).status).toBe(401);
    componentState.enabled = false;
    expect((await request()).status).toBe(403);
    componentState.enabled = true;
    accessDecision.granted = false;
    expect((await request()).status).toBe(403);
    expect(list).not.toHaveBeenCalled();
  });

  it("returns a generic server error when storage fails", async () => {
    list.mockRejectedValueOnce(new Error("database details"));
    const result = await request();
    expect(result.status).toBe(500);
    expect(JSON.stringify(result.body)).not.toContain("database details");
  });

  it("refuses invalid dates and assignment filters", async () => {
    expect((await request({ referenceDate: "2026-02-30" })).status).toBe(400);
    expect((await request({ currentAssignment: "sometimes" })).status).toBe(400);
    expect(list).not.toHaveBeenCalled();
  });

  it("keeps assignment details available while reporting sheet-specific access", async () => {
    sheetAccess.set("sheet-current", true);

    const result = await requestAssignmentDetails(true, { referenceDate: "2026-04-20" });

    expect(result.status).toBe(200);
    expect(result.body.prior).toEqual(expect.objectContaining({
      sheetId: "sheet-prior",
      canViewSheet: false,
    }));
    expect(result.body.current).toEqual(expect.objectContaining({
      sheetId: "sheet-current",
      canViewSheet: true,
    }));
    expect(getWorkerAssignmentDetails).toHaveBeenCalledWith("worker-1", "2026-04-20");
  });

  it("refuses an invalid assignment-details reference date", async () => {
    expect((await requestAssignmentDetails(true, { referenceDate: "not-a-date" })).status).toBe(400);
    expect(getWorkerAssignmentDetails).not.toHaveBeenCalled();
  });
});
