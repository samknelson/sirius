import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const {
  componentState,
  scenario,
  wcRequest,
  checkFlood,
  recordFloodEvent,
  logError,
  logWarn,
} = vi.hoisted(() => ({
  componentState: { enabled: true },
  scenario: {
    typeId: "t631-type" as string | null,
    exact: new Map<string, { workerId: string }>(),
    normalized: [] as Array<{ workerId: string }>,
    workerName: "Example Worker",
  },
  wcRequest: vi.fn(),
  checkFlood: vi.fn(),
  recordFloodEvent: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
}));

vi.mock("../../server/storage", () => ({
  storage: {
    workerIds: {
      getTypeIdBySiriusId: vi.fn(async () => scenario.typeId),
      getWorkerIdByTypeAndValue: vi.fn(
        async (_typeId: string, value: string) => scenario.exact.get(value),
      ),
      getWorkerIdsByTypeAndLeadingNonNumericPrefix: vi.fn(
        async () => scenario.normalized,
      ),
    },
    workers: {
      getWorkerDisplayName: vi.fn(async () => scenario.workerName),
    },
  },
}));

vi.mock("../../server/modules/components", () => ({
  requireComponent: () =>
    async (_req: unknown, res: any, next: () => void) => {
      if (componentState.enabled) {
        next();
        return;
      }
      res.status(403).json({
        message: 'Access denied: The "sitespecific.t631.client" feature is not enabled',
        error: "component_disabled",
      });
    },
}));

vi.mock("../../server/services/webclient", () => ({ wcRequest }));
vi.mock("../../server/flood/service", () => ({ checkFlood, recordFloodEvent }));
vi.mock("../../server/logger", () => ({
  logger: { error: logError, warn: logWarn },
}));

import { storage } from "../../server/storage";
import { registerT631ArrivalRoutes } from "../../server/modules/sitespecific/t631/arrive";
import { redactSensitiveUrlQuery } from "../../server/utils/redact-url-query";
import {
  T631_ARRIVAL_IP_FLOOD_EVENT,
  T631_ARRIVAL_WORKER_FLOOD_EVENT,
  t631ArrivalIpFloodEvent,
  t631ArrivalWorkerFloodEvent,
} from "../../server/flood/events";

type Middleware = (
  req: any,
  res: any,
  next: () => void,
) => Promise<void> | void;

let routePath = "";
let routeMiddleware: Middleware[] = [];
let pagePath = "";
let pageMiddleware: Middleware[] = [];

beforeAll(() => {
  registerT631ArrivalRoutes({
    get(path: string, ...handlers: Middleware[]) {
      pagePath = path;
      pageMiddleware = handlers;
    },
    post(path: string, ...handlers: Middleware[]) {
      routePath = path;
      routeMiddleware = handlers;
    },
  } as any);
});

beforeEach(() => {
  componentState.enabled = true;
  scenario.typeId = "t631-type";
  scenario.exact = new Map();
  scenario.normalized = [];
  scenario.workerName = "Example Worker";
  wcRequest.mockReset();
  checkFlood.mockReset();
  recordFloodEvent.mockReset();
  logError.mockReset();
  logWarn.mockReset();
  checkFlood.mockResolvedValue({ allowed: true });
  recordFloodEvent.mockResolvedValue(undefined);
  wcRequest.mockResolvedValue({
    source: "network",
    outcome: "success",
    fresh: true,
    value: { data: { data: true } },
  });
  vi.mocked(storage.workerIds.getTypeIdBySiriusId).mockClear();
  vi.mocked(storage.workerIds.getWorkerIdByTypeAndValue).mockClear();
  vi.mocked(
    storage.workerIds.getWorkerIdsByTypeAndLeadingNonNumericPrefix,
  ).mockClear();
});

async function post(body: unknown, ip = "203.0.113.10") {
  const result: { status: number; body?: any } = { status: 200 };
  const res = {
    status(code: number) {
      result.status = code;
      return res;
    },
    json(value: unknown) {
      result.body = value;
      return res;
    },
  };

  const req = { body, ip };
  for (const middleware of routeMiddleware) {
    let nextCalled = false;
    await middleware(req, res, () => {
      nextCalled = true;
    });
    if (!nextCalled) break;
  }
  return result;
}

describe("public T631 arrival route", () => {
  it("defines independent five-per-minute worker and IP flood budgets", () => {
    expect(t631ArrivalWorkerFloodEvent).toMatchObject({
      name: T631_ARRIVAL_WORKER_FLOOD_EVENT,
      threshold: 5,
      windowSeconds: 60,
    });
    expect(t631ArrivalIpFloodEvent).toMatchObject({
      name: T631_ARRIVAL_IP_FLOOD_EVENT,
      threshold: 5,
      windowSeconds: 60,
    });
    expect(
      t631ArrivalWorkerFloodEvent.getIdentifier({
        workerIdInput: "666666",
        ip: "203.0.113.10",
      }),
    ).toBe("666666");
    expect(
      t631ArrivalIpFloodEvent.getIdentifier({
        workerIdInput: "666666",
        ip: "203.0.113.10",
      }),
    ).toBe("203.0.113.10");
  });

  it("component-gates the page and sets a no-referrer response policy", async () => {
    expect(pagePath).toBe("/sitespecific/t631/arrive");
    expect(pageMiddleware).toHaveLength(2);

    const headers = new Map<string, string>();
    const res = {
      status() {
        return res;
      },
      json() {
        return res;
      },
      setHeader(name: string, value: string) {
        headers.set(name, value);
      },
    };
    const next = vi.fn();
    await pageMiddleware[0]({}, res, next);
    expect(next).toHaveBeenCalledOnce();
    await pageMiddleware[1]({}, res, next);
    expect(headers.get("Referrer-Policy")).toBe("no-referrer");
  });

  it("redacts the arrival token from request URLs used in diagnostics", () => {
    const redacted = redactSensitiveUrlQuery(
      "/sitespecific/t631/arrive?worker_id=666666&token=secret-value",
    );

    expect(redacted).toContain("worker_id=666666");
    expect(redacted).toContain("token=%28redacted%29");
    expect(redacted).not.toContain("secret-value");
  });

  it("registers a public route with only the component gate before its handler", () => {
    expect(routePath).toBe("/api/public/sitespecific/t631/arrive");
    expect(routeMiddleware).toHaveLength(2);
  });

  it("keeps the route unavailable when the T631 component is disabled", async () => {
    componentState.enabled = false;
    const response = await post({ worker_id: "666666", token: "secret" });

    expect(response.status).toBe(403);
    expect(response.body.error).toBe("component_disabled");
    expect(wcRequest).not.toHaveBeenCalled();
  });

  it("returns a 200 display error for missing public inputs", async () => {
    const response = await post({ worker_id: "666666" });

    expect(response).toEqual({
      status: 200,
      body: {
        authenticated: false,
        message: "A worker ID and token are required.",
      },
    });
    expect(wcRequest).not.toHaveBeenCalled();
    expect(checkFlood).not.toHaveBeenCalled();
    expect(recordFloodEvent).not.toHaveBeenCalled();
  });

  it("returns a 200 error when the t631 worker ID type is absent", async () => {
    scenario.typeId = null;
    const response = await post({ worker_id: "666666", token: "secret" });

    expect(response.status).toBe(200);
    expect(response.body.message).toBe(
      "The T631 worker ID type does not exist on this server.",
    );
    expect(checkFlood).not.toHaveBeenCalled();
    expect(recordFloodEvent).not.toHaveBeenCalled();
  });

  it("prefers an exact worker ID and does not run either fallback", async () => {
    scenario.exact.set("666666", { workerId: "worker-exact" });
    const response = await post({ worker_id: "666666", token: "secret" });

    expect(response.body.message).toBe(
      "Showing schedule for worker [Example Worker].",
    );
    expect(storage.workerIds.getWorkerIdByTypeAndValue).toHaveBeenCalledTimes(1);
    expect(
      storage.workerIds.getWorkerIdsByTypeAndLeadingNonNumericPrefix,
    ).not.toHaveBeenCalled();
  });

  it("tries the I-prefixed worker ID before normalized-prefix matching", async () => {
    scenario.exact.set("I666666", { workerId: "worker-i" });
    const response = await post({ worker_id: "666666", token: "secret" });

    expect(response.body.authenticated).toBe(true);
    expect(storage.workerIds.getWorkerIdByTypeAndValue).toHaveBeenNthCalledWith(
      1,
      "t631-type",
      "666666",
    );
    expect(storage.workerIds.getWorkerIdByTypeAndValue).toHaveBeenNthCalledWith(
      2,
      "t631-type",
      "I666666",
    );
    expect(
      storage.workerIds.getWorkerIdsByTypeAndLeadingNonNumericPrefix,
    ).not.toHaveBeenCalled();
  });

  it("takes the first normalized-prefix worker and sends the original link ID", async () => {
    scenario.normalized = [
      { workerId: "worker-first" },
      { workerId: "worker-second" },
    ];
    const response = await post({ worker_id: "666666", token: "secret" });

    expect(response.body.authenticated).toBe(true);
    expect(wcRequest).toHaveBeenCalledWith({
      vendor: { any: true },
      operation: "sitespecific.t631.server_switch.authenticate",
      args: { worker_id: "666666", token: "secret" },
      mode: "force",
    });
    expect(storage.workers.getWorkerDisplayName).toHaveBeenCalledWith(
      "worker-first",
    );
  });

  it("passes the original nonblank token to the Webclient operation", async () => {
    scenario.exact.set("666666", { workerId: "worker-exact" });
    await post({ worker_id: "666666", token: " secret with spaces " });

    expect(wcRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        args: {
          worker_id: "666666",
          token: " secret with spaces ",
        },
      }),
    );
  });

  it("returns the required 200 error when no worker matches", async () => {
    const response = await post({ worker_id: "666666", token: "secret" });

    expect(response.status).toBe(200);
    expect(response.body.message).toBe(
      "The worker with id [666666] does not exist on this server.",
    );
    expect(wcRequest).not.toHaveBeenCalled();
    expect(checkFlood).not.toHaveBeenCalled();
    expect(recordFloodEvent).not.toHaveBeenCalled();
  });

  it.each([
    T631_ARRIVAL_WORKER_FLOOD_EVENT,
    T631_ARRIVAL_IP_FLOOD_EVENT,
  ])("blocks the outbound call when the %s budget is exhausted", async (blockedEvent) => {
    scenario.exact.set("666666", { workerId: "worker-exact" });
    checkFlood.mockImplementation(async (eventName: string) => ({
      allowed: eventName !== blockedEvent,
    }));

    const response = await post(
      { worker_id: "666666", token: "secret" },
      "203.0.113.10",
    );

    expect(response).toEqual({
      status: 200,
      body: {
        authenticated: false,
        message: "Authentication failed for worker [666666].",
      },
    });
    expect(checkFlood).toHaveBeenCalledTimes(2);
    expect(wcRequest).not.toHaveBeenCalled();
    expect(recordFloodEvent).not.toHaveBeenCalled();
  });

  it("records both token-free buckets after a failed remote authentication", async () => {
    scenario.exact.set("666666", { workerId: "worker-exact" });
    wcRequest.mockResolvedValue({
      source: "network",
      outcome: "success",
      fresh: true,
      value: { data: { data: false } },
    });

    await post({ worker_id: "666666", token: "secret" }, "203.0.113.10");

    const context = { workerIdInput: "666666", ip: "203.0.113.10" };
    expect(recordFloodEvent).toHaveBeenNthCalledWith(
      1,
      T631_ARRIVAL_WORKER_FLOOD_EVENT,
      context,
    );
    expect(recordFloodEvent).toHaveBeenNthCalledWith(
      2,
      T631_ARRIVAL_IP_FLOOD_EVENT,
      context,
    );
    expect(JSON.stringify(recordFloodEvent.mock.calls)).not.toContain("secret");
  });

  it("records neither bucket after successful authentication", async () => {
    scenario.exact.set("666666", { workerId: "worker-exact" });

    await post({ worker_id: "666666", token: "secret" });

    expect(checkFlood).toHaveBeenCalledTimes(2);
    expect(recordFloodEvent).not.toHaveBeenCalled();
  });

  it.each([false, "true", 1, null, undefined])(
    "accepts only nested boolean true, not %j",
    async (remoteValue) => {
      scenario.exact.set("666666", { workerId: "worker-exact" });
      wcRequest.mockResolvedValue({
        source: "network",
        outcome: "success",
        fresh: true,
        value: { data: { data: remoteValue } },
      });

      const response = await post({ worker_id: "666666", token: "secret" });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        authenticated: false,
        message: "Authentication failed for worker [666666].",
      });
      expect(JSON.stringify(response.body)).not.toContain("secret");
    },
  );

  it("turns framework failures into the same non-sensitive 200 error", async () => {
    scenario.exact.set("666666", { workerId: "worker-exact" });
    wcRequest.mockRejectedValue(new Error("failure containing secret"));

    const response = await post({ worker_id: "666666", token: "secret" });

    expect(response.status).toBe(200);
    expect(response.body.message).toBe(
      "Authentication failed for worker [666666].",
    );
    expect(JSON.stringify(response.body)).not.toContain("secret");
    expect(logError).toHaveBeenCalledWith(
      "T631 public arrival authentication request failed",
      { source: "sitespecific-t631-arrive" },
    );
  });
});