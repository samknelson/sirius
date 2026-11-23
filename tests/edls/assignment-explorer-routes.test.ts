import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  component: true, coordinator: true, list: vi.fn(), exportRows: vi.fn(),
}));
vi.mock("../../server/storage", () => ({
  storage: { edlsAssignments: { listStatusAssignments: state.list, exportStatusAssignments: state.exportRows } },
}));
vi.mock("../../server/modules/components", () => ({
  requireComponent: (id: string) => (_req: unknown, res: any, next: () => void) => {
    expect(id).toBe("edls");
    if (!state.component) return res.status(403).json({});
    next();
  },
}));
vi.mock("../../server/services/access-policy-evaluator", () => ({
  requireAccess: (id: string) => (_req: unknown, res: any, next: () => void) => {
    expect(id).toBe("edls.coordinator");
    if (!state.coordinator) return res.status(403).json({});
    next();
  },
}));
import { registerEdlsAssignmentExplorerRoutes } from "../../server/modules/edls/assignment-explorer";

const routes = new Map<string, any[]>();
registerEdlsAssignmentExplorerRoutes({
  get: (path: string, ...handlers: any[]) => routes.set(path, handlers),
} as any, (req, res, next) => req.user ? next() : res.status(401).end());

async function request(path: string, authenticated = true, query: Record<string, unknown> = {}) {
  const result = { code: 200, chunks: [] as string[], body: undefined as unknown, headers: {} as Record<string, string> };
  const res: any = {
    status(code: number) { result.code = code; return res; },
    json(body: unknown) { result.body = body; return res; },
    end() {},
    set(key: string, value: string) { result.headers[key] = value; },
    vary() {},
    type() {},
    attachment() {},
    write(chunk: string) { result.chunks.push(chunk); return true; },
  };
  const req = { user: authenticated ? {} : undefined, query: { ymd: "2026-11-23", ...query } };
  const handlers = routes.get(path)!;
  for (const handler of handlers.slice(0, -1)) {
    let proceed = false;
    await handler(req, res, () => { proceed = true; });
    if (!proceed) return result;
  }
  await handlers.at(-1)(req, res);
  return result;
}

beforeEach(() => {
  state.component = state.coordinator = true;
  state.list.mockReset().mockResolvedValue({ rows: [], total: 0 });
  state.exportRows.mockReset().mockImplementation(async (_query, write) => {
    // Two batches prove the route doesn't export just the visible page.
    const row = {
      id: "a", ymd: "2026-11-23", workerName: "Worker", sheetTitle: "Sheet",
      sheetId: "s", sheetStatus: "lock", crewTitle: "Crew", startTime: "08:00",
      accepted: null, commId: null, notified: "none", inPopulation: false,
    };
    await write([row]);
    await write([{ ...row, id: "b" }]);
  });
});

describe.each(["/api/edls/assignments", "/api/edls/assignments/export"])("%s authorization", path => {
  it("refuses anonymous, component-disabled, and non-coordinator requests before storage", async () => {
    expect((await request(path, false)).code).toBe(401);
    state.component = false;
    expect((await request(path)).code).toBe(403);
    state.component = true;
    state.coordinator = false;
    expect((await request(path)).code).toBe(403);
    expect(state.list).not.toHaveBeenCalled();
    expect(state.exportRows).not.toHaveBeenCalled();
  });
  it("validates before querying and disables shared response caching", async () => {
    expect((await request(path, true, { ymd: "2026-02-30" })).code).toBe(400);
    expect(state.list).not.toHaveBeenCalled();
    expect(state.exportRows).not.toHaveBeenCalled();
    const response = await request(path, true, { accepted: "no", notified: "none", population: "no", page: "2" });
    expect(response.code).toBe(200);
    expect(response.headers["Cache-Control"]).toBe("private, no-store");
    const method = path.endsWith("export") ? state.exportRows : state.list;
    expect(method.mock.calls[0][0]).toMatchObject({ accepted: "no", notified: "none", population: "no", page: 2 });
    if (path.endsWith("export")) expect(response.chunks.join("")).toContain("b,2026-11-23");
  });
});
