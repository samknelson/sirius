import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  list: vi.fn(), getById: vi.fn(),
}));
vi.mock("../server/storage", () => ({
  storage: {
    pluginConfigs: {
      getByKindAndPlugin: async () => [{ id: "config" }],
      getWithSubsidiary: async () => ({ config: { id: "config" } }),
    },
    jobRuns: mocks,
  },
}));
vi.mock("../server/services/access-policy-evaluator", () => ({ requireAccess: () => () => {} }));
vi.mock("../server/cron", () => ({ cronScheduler: {} }));
vi.mock("../server/plugins/system/cron", () => ({ cronPluginRegistry: {} }));

import { registerCronJobRoutes } from "../server/modules/system/cron";

const routes = new Map<string, Function>();
registerCronJobRoutes({
  get: (path: string, ...handlers: Function[]) => routes.set(path, handlers.at(-1)!),
  post: () => {},
} as any, (() => {}) as any, (() => {}) as any);
async function request(path: string, query = {}, params = { name: "t631", runId: "run" }) {
  const res = { statusCode: 200, body: null as any, status(code: number) { this.statusCode = code; return this; }, json(body: any) { this.body = body; return this; } };
  await routes.get(path)!({ query, params }, res);
  return res;
}
beforeEach(() => vi.resetAllMocks());

describe("bounded cron history", () => {
  it("loads a bounded second page without output and reports more rows", async () => {
    mocks.list.mockResolvedValue(Array.from({ length: 26 }, (_, id) => ({ id })));
    const res = await request("/api/cron-jobs/:name/runs", { page: "2" });
    expect(mocks.list).toHaveBeenCalledWith({ pluginKind: "cron", pluginId: "t631", offset: 25, limit: 26, summaryOnly: true });
    expect(res.body.runs).toHaveLength(25);
    expect(res.body.hasMore).toBe(true);
  });
  it.each(["0", "-1", "1.5", "NaN", "1000001"])("rejects invalid page %s", async page => {
    expect((await request("/api/cron-jobs/:name/runs", { page })).statusCode).toBe(400);
    expect(mocks.list).not.toHaveBeenCalled();
  });
  it("returns an empty final page without claiming more history", async () => {
    mocks.list.mockResolvedValue([]);
    expect((await request("/api/cron-jobs/:name/runs")).body).toMatchObject({ runs: [], hasMore: false, page: 1 });
  });
  it("does not return another job's full run", async () => {
    mocks.getById.mockResolvedValue({ pluginKind: "cron", pluginId: "other" });
    expect((await request("/api/cron-jobs/:name/runs/:runId")).statusCode).toBe(404);
  });
  it("loads full output for the selected matching run", async () => {
    const run = { pluginKind: "cron", pluginId: "t631", output: "full details" };
    mocks.getById.mockResolvedValue(run);
    expect((await request("/api/cron-jobs/:name/runs/:runId")).body).toEqual(run);
  });
});
