/**
 * The worker EDLS assignments route is a NEW way to read one worker's entire
 * schedule: every sheet they have ever been on, in one request, from a staff
 * screen. Nothing exposed that before — the same storage read was reachable
 * only through the worker's own token-authorized schedule page, capped at a
 * week. These tests pin what that new surface is allowed to do: who gets
 * through to it, which worker's rows it returns, and how much of each row it
 * hands over.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const WORKER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_WORKER_ID = "22222222-2222-4222-8222-222222222222";

interface StoredAssignment {
  assignmentId: string;
  ymd: string;
  sheetId: string;
  sheetTitle: string;
  sheetStatus: string;
  crewId: string;
  crewTitle: string;
  startTime: string | null;
  endTime: string | null;
  location: string | null;
  supervisor: { id: string; firstName: string | null; lastName: string | null; email: string } | null;
  facility: { id: string; name: string } | null;
  jobGroup: { id: string; name: string } | null;
  department: { id: string; name: string } | null;
  employer: { id: string; name: string } | null;
  showStatus: { id: string; name: string } | null;
  task: { id: string; name: string } | null;
  accepted: boolean | null;
  data: Record<string, unknown> | null;
}

function assignment(overrides: Partial<StoredAssignment> = {}): StoredAssignment {
  return {
    assignmentId: "assignment-1",
    ymd: "2026-01-05",
    sheetId: "sheet-1",
    sheetTitle: "Load-in",
    sheetStatus: "lock",
    crewId: "crew-1",
    crewTitle: "Stage crew",
    startTime: "08:00:00",
    endTime: "16:00:00",
    location: "Dock 4",
    supervisor: { id: "user-1", firstName: "Sam", lastName: "Super", email: "sam@example.com" },
    facility: { id: "facility-1", name: "Main Hall" },
    jobGroup: { id: "group-1", name: "Show 44" },
    department: { id: "department-1", name: "Riggers" },
    employer: { id: "employer-1", name: "Acme Events" },
    showStatus: { id: "show-1", name: "Confirmed" },
    task: { id: "task-1", name: "Rigging" },
    accepted: true,
    data: { note: "arrive early" },
    ...overrides,
  };
}

/** Rows the fake storage holds, keyed by worker. */
let byWorker: Record<string, StoredAssignment[]>;

const { componentState, getAssignmentsForWorker, accessDecision } = vi.hoisted(() => ({
  componentState: { enabled: {} as Record<string, boolean> },
  getAssignmentsForWorker: vi.fn(),
  accessDecision: { granted: true },
}));

vi.mock("../../server/storage", () => ({
  storage: {
    edlsAssignments: { getAssignmentsForWorker },
  },
}));

vi.mock("../../server/services/component-cache", () => ({
  isCacheInitialized: () => true,
  loadComponentCache: vi.fn(),
  isComponentEnabledSync: (componentId: string) => componentState.enabled[componentId] === true,
}));

vi.mock("@shared/components", () => ({
  getAllComponents: () => [],
  getComponentById: (componentId: string) => ({ id: componentId, name: componentId }),
}));

vi.mock("../../server/services/component-lifecycle", () => ({
  enableComponentSchema: vi.fn(),
  disableComponentSchema: vi.fn(),
  repairComponentSchema: vi.fn(),
  reconcileComponentPluginConfigs: vi.fn(),
  checkComponentSchemaDrift: vi.fn(),
  getComponentSchemaInfo: vi.fn(),
}));

vi.mock("../../server/services/component-permissions", () => ({
  syncComponentPermissions: vi.fn(),
}));

vi.mock("../../server/services/access-policy-evaluator", () => ({
  clearAccessCache: vi.fn(),
  // Stands in for the real policy middleware: it either lets the request
  // through or answers 403 without calling the handler.
  requireAccess: (_policyId: string, _entityId: unknown) => (req: any, res: any, next: () => void) => {
    if (accessDecision.granted) return next();
    res.status(403).json({ message: "Access denied" });
  },
}));

import { registerWorkerEdlsRoutes } from "../../server/modules/edls/workers";

type Handler = (req: any, res: any) => Promise<void>;
let middleware: Array<(req: any, res: any, next: () => void) => Promise<void> | void>;
let handler: Handler;

beforeAll(() => {
  const requireAuth = (req: any, res: any, next: () => void) => {
    if (req.user) return next();
    res.status(401).json({ message: "Unauthorized" });
  };

  registerWorkerEdlsRoutes(
    {
      get(path: string, ...args: unknown[]) {
        if (path !== "/api/workers/:id/edls/assignments") return;
        middleware = args.slice(0, -1) as typeof middleware;
        handler = args.at(-1) as Handler;
      },
      put() {},
    } as any,
    requireAuth as any,
  );
});

beforeEach(() => {
  componentState.enabled = { edls: true };
  accessDecision.granted = true;
  byWorker = {
    [WORKER_ID]: [
      assignment(),
      assignment({
        assignmentId: "assignment-2",
        ymd: "2026-02-09",
        sheetId: "sheet-2",
        sheetTitle: "Strike",
        sheetStatus: "draft",
        crewTitle: "Load-out crew",
      }),
    ],
    [OTHER_WORKER_ID]: [
      assignment({ assignmentId: "assignment-other", sheetTitle: "Someone else's sheet" }),
    ],
  };
  getAssignmentsForWorker.mockReset();
  getAssignmentsForWorker.mockImplementation(async (workerId: string) => byWorker[workerId] ?? []);
});

async function request(workerId: string, { authenticated = true } = {}) {
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
  const req: any = { params: { id: workerId } };
  if (authenticated) req.user = { claims: { sub: "user-1" } };

  for (const step of middleware) {
    let nextCalled = false;
    await step(req, res, () => {
      nextCalled = true;
    });
    if (!nextCalled) return result;
  }
  await handler(req, res);
  return result;
}

describe("GET /api/workers/:id/edls/assignments", () => {
  it("returns the worker's assignments across every sheet", async () => {
    const result = await request(WORKER_ID);

    expect(result.status).toBe(200);
    expect(result.body.map((a: any) => a.sheetId)).toEqual(["sheet-1", "sheet-2"]);
    expect(result.body[0]).toEqual({
      assignmentId: "assignment-1",
      ymd: "2026-01-05",
      sheetId: "sheet-1",
      sheetTitle: "Load-in",
      sheetStatus: "lock",
      crewTitle: "Stage crew",
      jobGroup: { id: "group-1", name: "Show 44" },
      facility: { id: "facility-1", name: "Main Hall" },
      department: { id: "department-1", name: "Riggers" },
    });
  });

  it("reads only the worker named in the URL", async () => {
    const result = await request(OTHER_WORKER_ID);

    expect(getAssignmentsForWorker).toHaveBeenCalledWith(OTHER_WORKER_ID);
    expect(result.body.map((a: any) => a.assignmentId)).toEqual(["assignment-other"]);
  });

  it("asks for every date and every status, leaving the trash exclusion to the storage default", async () => {
    await request(WORKER_ID);

    // A filter argument here would silently narrow a list whose whole point is
    // to be complete — no date window, no status list.
    expect(getAssignmentsForWorker).toHaveBeenCalledWith(WORKER_ID);
    expect(getAssignmentsForWorker.mock.calls[0]).toHaveLength(1);
  });

  it("withholds the fields this screen does not show", async () => {
    const result = await request(WORKER_ID);

    for (const row of result.body) {
      expect(row).not.toHaveProperty("supervisor");
      expect(row).not.toHaveProperty("accepted");
      expect(row).not.toHaveProperty("data");
      expect(row).not.toHaveProperty("location");
      expect(row).not.toHaveProperty("startTime");
    }
    expect(JSON.stringify(result.body)).not.toContain("sam@example.com");
  });

  it("passes the job group through as null so the list can drop the Event column", async () => {
    byWorker[WORKER_ID] = [assignment({ jobGroup: null })];

    const result = await request(WORKER_ID);

    expect(result.body[0].jobGroup).toBeNull();
  });

  it("returns an empty list for a worker with no assignments", async () => {
    byWorker[WORKER_ID] = [];

    await expect(request(WORKER_ID)).resolves.toEqual({ status: 200, body: [] });
  });

  it("refuses an unauthenticated request", async () => {
    const result = await request(WORKER_ID, { authenticated: false });

    expect(result.status).toBe(401);
    expect(getAssignmentsForWorker).not.toHaveBeenCalled();
  });

  it("refuses when the EDLS component is off", async () => {
    componentState.enabled.edls = false;

    const result = await request(WORKER_ID);

    expect(result).toMatchObject({
      status: 403,
      body: { error: "component_disabled", componentId: "edls" },
    });
    expect(getAssignmentsForWorker).not.toHaveBeenCalled();
  });

  it("refuses a caller without coordinator access to this worker", async () => {
    accessDecision.granted = false;

    const result = await request(WORKER_ID);

    expect(result).toEqual({ status: 403, body: { message: "Access denied" } });
    expect(getAssignmentsForWorker).not.toHaveBeenCalled();
  });

  it("answers 500 without leaking the failure when storage throws", async () => {
    getAssignmentsForWorker.mockRejectedValueOnce(new Error("connection terminated"));

    const result = await request(WORKER_ID);

    expect(result.status).toBe(500);
    expect(JSON.stringify(result.body)).not.toContain("connection terminated");
  });
});
