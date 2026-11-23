import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSheet: vi.fn(),
  getAssignments: vi.fn(),
  getAssignmentWorkerIds: vi.fn(),
  getPopulationWorkerIds: vi.fn(),
  getAvailableWorkersForSheet: vi.fn(),
  getWorkerIds: vi.fn(),
  getEmployer: vi.fn(),
  settings: { worker_id_type: "ein" as string | null },
  componentEnabled: true,
  accessGranted: true,
  policyTargets: [] as unknown[],
}));
vi.mock("../../server/storage", () => ({
  storage: {
    edlsSheets: { get: mocks.getSheet },
    edlsAssignments: {
      getBySheetId: mocks.getAssignments,
      getWorkerIdsBySheetId: mocks.getAssignmentWorkerIds,
      getPopulationWorkerIds: mocks.getPopulationWorkerIds,
      getAvailableWorkersForSheet: mocks.getAvailableWorkersForSheet,
    },
    workerIds: { getWorkerIdsByTypeForWorkerIds: mocks.getWorkerIds },
    employers: { getEmployer: mocks.getEmployer },
  },
}));
vi.mock("../../server/modules/edls/supervisor-context", () => ({
  getEdlsSettings: async () => mocks.settings,
  getSupervisorContext: vi.fn(),
  validateSupervisorForSave: vi.fn(),
}));
vi.mock("../../server/modules/masquerade", () => ({ getEffectiveUser: vi.fn() }));
vi.mock("../../server/services/component-cache", () => ({ isComponentEnabledSync: vi.fn() }));
vi.mock("../../server/modules/components", () => ({
  requireComponent: () => (_req: any, res: any, next: () => void) =>
    mocks.componentEnabled ? next() : res.status(403).json({ message: "Component disabled" }),
}));
vi.mock("../../server/services/access-policy-evaluator", () => ({
  requireAccess: (policy: string, target: any) => (req: any, res: any, next: () => void) => {
    mocks.policyTargets.push([policy, target(req)]);
    if (mocks.accessGranted) next();
    else res.status(403).json({ message: "Access denied" });
  },
}));

import { registerEdlsSheetsRoutes } from "../../server/modules/edls/sheets";

type Handler = (req: any, res: any, next: () => void) => unknown;
let handlers: Handler[];
beforeAll(() => {
  const app = Object.fromEntries(["get", "post", "put", "patch", "delete"].map(verb => [
    verb, (path: string, ...callbacks: Handler[]) => {
      if (verb === "get" && path === "/api/edls/sheets/:id/worker-display-ids") handlers = callbacks;
    },
  ]));
  registerEdlsSheetsRoutes(app as any, (req: any, res: any, next: () => void) =>
    req.user ? next() : res.status(401).json({ message: "Unauthorized" }), vi.fn());
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.settings.worker_id_type = "ein";
  mocks.componentEnabled = true;
  mocks.accessGranted = true;
  mocks.policyTargets = [];
  mocks.getSheet.mockResolvedValue({ id: "sheet", employerId: "employer", ymd: "2026-06-15" });
  mocks.getAssignmentWorkerIds.mockResolvedValue([
    "inactive-assigned", "active", "inactive-assigned",
  ]);
  mocks.getPopulationWorkerIds.mockResolvedValue(["active", "unassigned", "no-id"]);
  mocks.getWorkerIds.mockImplementation(async (type: string, ids: string[]) =>
    ids.filter(id => id !== "no-id").map(workerId => ({ workerId, value: `${type}:${workerId}` })));
});

async function request(authenticated = true) {
  const result = { status: 200, body: undefined as any };
  const res = {
    status(code: number) { result.status = code; return res; },
    json(body: unknown) { result.body = body; return res; },
  };
  for (const handler of handlers) {
    let continued = false;
    await handler({ params: { id: "sheet" }, user: authenticated ? {} : null }, res, () => { continued = true; });
    if (!continued) break;
  }
  return result;
}

describe("sheet worker display IDs", () => {
  it.each(["ein", "another-type"])("preserves the old mapping for configured type %s without enrichment", async type => {
    mocks.settings.worker_id_type = type;
    // The old route consumed only the IDs of these fully enriched workers.
    const oldAvailableWorkers = ["active", "unassigned", "no-id"].map(id => ({
      id, priorStatus: "lock", currentStatus: null, nextStatus: "draft", displayName: id,
    }));
    const oldIds = [...new Set([
      "inactive-assigned", "active", "inactive-assigned", ...oldAvailableWorkers.map(w => w.id),
    ])];
    const oldValues = Object.fromEntries(
      oldIds.filter(id => id !== "no-id").map(id => [id, `${type}:${id}`]),
    );
    expect(await request()).toEqual({
      status: 200, body: { workerIdTypeConfigured: true, values: oldValues },
    });
    expect(mocks.getWorkerIds).toHaveBeenCalledWith(type, oldIds);
    expect(mocks.getAssignmentWorkerIds).toHaveBeenCalledWith("sheet");
    expect(mocks.getAssignments).not.toHaveBeenCalled();
    expect(mocks.getPopulationWorkerIds).toHaveBeenCalledWith();
    expect(mocks.getAvailableWorkersForSheet).not.toHaveBeenCalled();
    expect(mocks.getEmployer).not.toHaveBeenCalled();
    expect(mocks.policyTargets).toEqual([["edls.sheet.view", "sheet"]]);
  });

  it("returns empty values for an empty population and sheet", async () => {
    mocks.getAssignmentWorkerIds.mockResolvedValue([]);
    mocks.getPopulationWorkerIds.mockResolvedValue([]);
    expect((await request()).body).toEqual({ workerIdTypeConfigured: true, values: {} });
    expect(mocks.getWorkerIds).toHaveBeenCalledWith("ein", []);
  });

  it("does not read worker IDs when no type is configured", async () => {
    mocks.settings.worker_id_type = null;
    expect((await request()).body).toEqual({ workerIdTypeConfigured: false, values: {} });
    expect(mocks.getAssignments).not.toHaveBeenCalled();
    expect(mocks.getAssignmentWorkerIds).not.toHaveBeenCalled();
    expect(mocks.getPopulationWorkerIds).not.toHaveBeenCalled();
    expect(mocks.getWorkerIds).not.toHaveBeenCalled();
  });

  it("returns 404 before worker reads for a missing sheet", async () => {
    mocks.getSheet.mockResolvedValue(undefined);
    expect((await request()).status).toBe(404);
    expect(mocks.getAssignmentWorkerIds).not.toHaveBeenCalled();
    expect(mocks.getPopulationWorkerIds).not.toHaveBeenCalled();
    expect(mocks.getWorkerIds).not.toHaveBeenCalled();
  });

  it.each(["authentication", "component", "sheet-access"])("keeps the %s gate before all data reads", async gate => {
    mocks.componentEnabled = gate !== "component";
    mocks.accessGranted = gate !== "sheet-access";
    expect((await request(gate !== "authentication")).status).toBe(gate === "authentication" ? 401 : 403);
    expect(mocks.getSheet).not.toHaveBeenCalled();
    expect(mocks.getAssignmentWorkerIds).not.toHaveBeenCalled();
    expect(mocks.getPopulationWorkerIds).not.toHaveBeenCalled();
    expect(mocks.getWorkerIds).not.toHaveBeenCalled();
  });
});
