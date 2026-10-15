import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Express } from "express";
const { flags, service, store } = vi.hoisted(() => ({
  flags: { authenticated: true, component: true, staff: true, admin: false, bulk: false },
  service: {
    listWorkerCommsDefinitions: vi.fn().mockResolvedValue([]),
    getWorkerCommsDefinition: vi.fn().mockResolvedValue({ id: "def" }),
    validateWorkerCommsReferences: vi.fn().mockResolvedValue(undefined),
    saveWorkerCommsDefinition: vi.fn().mockResolvedValue({ id: "def" }),
    deleteWorkerCommsDefinition: vi.fn().mockResolvedValue(undefined),
  },
  store: { workerCommsCompliance: {
    report: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
    contacts: vi.fn().mockResolvedValue(["c"]),
    options: vi.fn().mockResolvedValue({ tags: [] }),
  } },
}));
vi.mock("../../server/storage", () => ({ storage: store }));
vi.mock("../../server/services/access-policy-evaluator", () => ({
  requireAccess: (policy: string) => (_req: unknown, res: any, next: () => void) => {
    const granted = policy === "staff" ? flags.staff : policy === "admin" ? flags.admin : flags.bulk;
    if (granted) next(); else res.status(403).json({ message: "denied" });
  },
  checkAccess: async (policy: string) => ({ granted: policy === "admin" ? flags.admin : flags.bulk }),
}));
vi.mock("../../server/modules/components", () => ({
  requireComponent: () => (_req: unknown, res: any, next: () => void) => {
    if (flags.component) next(); else res.status(403).json({ message: "disabled" });
  },
  isComponentEnabled: async () => flags.component,
}));
vi.mock("../../server/modules/masquerade", () => ({ getEffectiveUser: async () => ({ dbUser: { id: "effective" } }) }));
vi.mock("../../server/services/worker-comms-compliance", () => ({
  ...service,
  WorkerCommsError: class extends Error {},
}));
vi.mock("../../server/logger", () => ({ logger: { error: vi.fn() } }));
import { registerWorkerCommsComplianceRoutes } from "../../server/modules/worker-comms-compliance";

type Handler = (req: any, res: any, next: () => void) => unknown;
function harness() {
  const routes: { method: string; path: string; handlers: Handler[] }[] = [];
  const app = Object.fromEntries(["get", "post", "put", "delete"].map(method => [
    method, (path: string, ...handlers: Handler[]) => routes.push({ method, path, handlers }),
  ]));
  registerWorkerCommsComplianceRoutes(app as unknown as Express, (_req, res, next) => {
    if (flags.authenticated) next(); else res.status(401).json({ message: "unauthenticated" });
  });
  async function request(method: string, suffix: string, query: Record<string, unknown> = {}) {
    const route = routes.find(r => r.method === method && r.path === `/api/worker-comms-compliance${suffix}`)!;
    const response = { code: 200, body: undefined as unknown, ended: false,
      setHeader: vi.fn(), status(code: number) { this.code = code; return this; },
      json(body: unknown) { this.body = body; this.ended = true; return this; } };
    async function run(index: number): Promise<void> {
      if (response.ended || index >= route.handlers.length) return;
      let continuation: Promise<void> | undefined;
      await route.handlers[index]({ params: { id: "def" }, query, session: {}, body: {}, user: {} }, response,
        () => { continuation = run(index + 1); });
      if (continuation) await continuation;
    }
    await run(0);
    return response;
  }
  return { routes, request };
}

describe("worker comms compliance route boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(flags, { authenticated: true, component: true, staff: true, admin: false, bulk: false });
  });
  it.each(["authentication", "component", "staff"])("gates every endpoint on %s", async gate => {
    if (gate === "authentication") flags.authenticated = false;
    if (gate === "component") flags.component = false;
    if (gate === "staff") flags.staff = false;
    const { routes, request } = harness();
    for (const route of routes) {
      const result = await request(route.method, route.path.replace("/api/worker-comms-compliance", ""));
      expect(result.code).toBe(gate === "authentication" ? 401 : 403);
    }
    expect(service.listWorkerCommsDefinitions).not.toHaveBeenCalled();
    expect(store.workerCommsCompliance.report).not.toHaveBeenCalled();
    expect(service.saveWorkerCommsDefinition).not.toHaveBeenCalled();
  });
  it("allows staff to read but requires admin for all definition writes", async () => {
    const { request } = harness();
    expect((await request("get", "/definitions")).code).toBe(200);
    for (const [method, route] of [["post", "/definitions"], ["put", "/definitions/:id"], ["delete", "/definitions/:id"]]) {
      expect((await request(method, route)).code).toBe(403);
    }
    expect(service.saveWorkerCommsDefinition).not.toHaveBeenCalled();
    flags.admin = true;
    expect((await request("post", "/definitions")).code).toBe(201);
    expect((await request("put", "/definitions/:id")).code).toBe(200);
    expect((await request("delete", "/definitions/:id")).code).toBe(200);
  });
  it("does not grant select-all recipient access just because staff can read reports", async () => {
    const { request } = harness();
    expect((await request("get", "/definitions/:id/report")).code).toBe(200);
    expect((await request("get", "/definitions/:id/contacts")).code).toBe(403);
    expect(store.workerCommsCompliance.contacts).not.toHaveBeenCalled();
    flags.bulk = true;
    expect((await request("get", "/definitions/:id/contacts", { view: "without" })).body).toEqual({ contactIds: ["c"], total: 1 });
  });
  it("rejects malformed pagination and view rather than silently broadening the result", async () => {
    const { request } = harness();
    for (const query of [{ page: "0" }, { pageSize: "10000" }, { view: "unknown" }]) {
      expect((await request("get", "/definitions/:id/report", query)).code).toBe(400);
    }
    expect(store.workerCommsCompliance.report).not.toHaveBeenCalled();
  });
});
