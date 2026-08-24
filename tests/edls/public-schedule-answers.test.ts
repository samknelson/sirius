/**
 * The public schedule answer route turns a schedule-link credential into a
 * final state change. These tests isolate its authorization decision from the
 * database and Express plumbing: only a current worker.aat token may answer,
 * it may answer only an assignment the matching page lists, and the storage
 * layer's conditional write remains the final replay guard.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const WORKER_ID = "11111111-1111-4111-8111-111111111111";
const ACCESS_TOKEN = "33333333-3333-4333-8333-333333333333";
const REVOKED_TOKEN = "44444444-4444-4444-8444-444444444444";
const ASSIGNMENT_ID = "55555555-5555-4555-8555-555555555555";
const OTHER_ASSIGNMENT_ID = "66666666-6666-4666-8666-666666666666";

interface Scenario {
  tokens: Record<string, { workerId: string } | undefined>;
  visibleAssignments: Array<{ assignmentId: string; accepted: boolean | null }>;
  setAcceptedResult: boolean;
}

let scenario: Scenario;
const { componentState, setAccepted } = vi.hoisted(() => ({
  componentState: { enabled: {} as Record<string, boolean> },
  setAccepted: vi.fn(),
}));

vi.mock("../../server/storage", () => ({
  storage: {
    workerAat: {
      async getByAccessUuid(id: string) {
        return scenario.tokens[id];
      },
    },
    edlsAssignments: {
      async get(id: string) {
        // Pre-AAT links resolve assignment ids only for reads. The route under
        // test explicitly forbids that fallback for irreversible answers.
        return id === WORKER_ID ? { workerId: WORKER_ID } : undefined;
      },
      async getAssignmentsForWorker() {
        return scenario.visibleAssignments;
      },
      setAccepted,
    },
    workerEdls: {
      async hasEdlsPresence() {
        return true;
      },
    },
    workers: {
      async getWorker() {
        return { id: WORKER_ID, contactId: "contact" };
      },
    },
    contacts: {
      async getContact() {
        return { given: "Worker", family: "Example", displayName: "Worker Example" };
      },
    },
  },
}));

vi.mock("../../server/services/component-cache", () => ({
  isCacheInitialized: () => true,
  loadComponentCache: vi.fn(),
  isComponentEnabledSync: (componentId: string) => componentState.enabled[componentId] === true,
}));

vi.mock("@shared/components", () => ({
  getAllComponents: () => [],
  getComponentById: (componentId: string) => ({
    id: componentId,
    name: componentId === "worker.aat" ? "Worker Access Tokens" : componentId,
  }),
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
  requireAccess: vi.fn(),
  clearAccessCache: vi.fn(),
}));

vi.mock("../../server/flood/service", () => ({
  async checkFlood() {
    return { allowed: true };
  },
  async recordFloodEvent() {},
}));

vi.mock("../../server/flood/events", () => ({
  EDLS_SCHEDULE_ANSWER_FLOOD_EVENT: "edls-schedule-answer",
}));

vi.mock("../../server/logger", () => ({
  logger: { warn: vi.fn() },
}));

import { registerEdlsPublicScheduleRoutes } from "../../server/modules/edls/public-schedule";

type Handler = (req: any, res: any) => Promise<void>;
let answerHandler: Handler;
let answerMiddleware: Array<(req: any, res: any, next: () => void) => Promise<void> | void>;

beforeAll(() => {
  registerEdlsPublicScheduleRoutes({
    get() {},
    post(...args: unknown[]) {
      answerMiddleware = args.slice(1, -1) as typeof answerMiddleware;
      answerHandler = args.at(-1) as Handler;
    },
  } as any);
});

beforeEach(() => {
  componentState.enabled = { edls: true, "worker.aat": true };
  scenario = {
    tokens: { [ACCESS_TOKEN]: { workerId: WORKER_ID } },
    visibleAssignments: [{ assignmentId: ASSIGNMENT_ID, accepted: null }],
    setAcceptedResult: true,
  };
  setAccepted.mockReset();
  setAccepted.mockImplementation(async () => scenario.setAcceptedResult);
});

async function answer(scheduleId: string, assignmentId = ASSIGNMENT_ID, accepted = true) {
  const result: { status: number; body?: unknown } = { status: 200 };
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

  const req = { params: { id: scheduleId, assignmentId }, body: { accepted }, ip: "127.0.0.1" };
  for (const middleware of answerMiddleware) {
    let nextCalled = false;
    await middleware(req, res, () => {
      nextCalled = true;
    });
    if (!nextCalled) return result;
  }
  await answerHandler(req, res);
  return result;
}

describe("public EDLS schedule answers", () => {
  it("records an answer for an assignment shown to the current AAT token", async () => {
    await expect(answer(ACCESS_TOKEN, ASSIGNMENT_ID, false)).resolves.toEqual({
      status: 200,
      body: { assignmentId: ASSIGNMENT_ID, accepted: false },
    });
    expect(setAccepted).toHaveBeenCalledWith(ASSIGNMENT_ID, false);
  });

  it.each([
    ["a worker id", WORKER_ID],
    ["a revoked token", REVOKED_TOKEN],
  ])("refuses %s instead of accepting it as an answer credential", async (_label, id) => {
    const result = await answer(id);

    expect(result).toEqual({ status: 403, body: { message: "Access denied" } });
    expect(setAccepted).not.toHaveBeenCalled();
  });

  it("refuses an assignment that the token holder's schedule does not show", async () => {
    const result = await answer(ACCESS_TOKEN, OTHER_ASSIGNMENT_ID);

    expect(result).toEqual({ status: 403, body: { message: "Access denied" } });
    expect(setAccepted).not.toHaveBeenCalled();
  });

  it("refuses a replay when the conditional write says another answer won", async () => {
    scenario.setAcceptedResult = false;

    const result = await answer(ACCESS_TOKEN);

    expect(result).toEqual({ status: 403, body: { message: "Access denied" } });
    expect(setAccepted).toHaveBeenCalledOnce();
  });

  it("stops before storage when worker.aat is disabled with its token retained", async () => {
    componentState.enabled["worker.aat"] = false;

    const result = await answer(ACCESS_TOKEN);

    expect(result).toMatchObject({
      status: 403,
      body: {
        error: "component_disabled",
        componentId: "worker.aat",
      },
    });
    expect(setAccepted).not.toHaveBeenCalled();
  });

  it("uses the same generic denial for credential, visibility, and replay refusals", async () => {
    const credential = await answer(REVOKED_TOKEN);
    const visibility = await answer(ACCESS_TOKEN, OTHER_ASSIGNMENT_ID);
    scenario.setAcceptedResult = false;
    const replay = await answer(ACCESS_TOKEN);

    expect(credential.body).toEqual(visibility.body);
    expect(visibility.body).toEqual(replay.body);
  });
});