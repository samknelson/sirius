import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  claim: vi.fn(), renew: vi.fn(), release: vi.fn(), guarded: vi.fn(),
  search: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), recover: vi.fn(), interrupt: vi.fn(),
  execute: vi.fn(), manualRun: vi.fn(), getById: vi.fn(), maintenance: false,
  tasks: [] as { callback: () => Promise<void>; start: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }[],
}));
vi.mock("../../server/storage/system/semaphores", async importOriginal => {
  const original = await importOriginal<typeof import("../../server/storage/system/semaphores")>();
  return { ...original, semaphoreStorage: {
    claim: mocks.claim, renew: mocks.renew, release: mocks.release, guarded: mocks.guarded,
  } };
});
vi.mock("../../server/storage/db", () => ({ pool: {} }));
vi.mock("../../server/storage", () => ({ storage: {
  pluginConfigs: { search: mocks.search, getWithSubsidiary: mocks.get, getByKindAndPlugin: async () => [{ id: "config" }] },
  jobRuns: { create: mocks.create, update: mocks.update, interruptAbandonedCronRuns: mocks.recover, interruptIfRunning: mocks.interrupt, getById: mocks.getById },
} }));
vi.mock("../../server/cron", () => ({ cronScheduler: { manualRun: mocks.manualRun } }));
vi.mock("../../server/services/access-policy-evaluator", () => ({ requireAccess: () => () => {} }));
vi.mock("../../server/auth/helpers", () => ({ resolveDbUser: async () => ({ id: "user" }) }));
vi.mock("../../server/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("../../server/plugins/system/cron", () => ({
  cronPluginRegistry: { has: () => true, get: () => ({ metadata: {} }) }, executeCronPlugin: mocks.execute,
}));
vi.mock("../../server/modules/components", () => ({ getEnabledComponentIds: async () => [] }));
vi.mock("../../server/storage/configuration-revisions", () => ({ readConfigurationSnapshot: (f: () => unknown) => f() }));
vi.mock("../../server/services/maintenance-flag", () => ({ isMaintenanceActive: () => mocks.maintenance }));
vi.mock("node-cron", () => ({
  validate: () => true,
  createTask: (_schedule: string, callback: () => Promise<void>) => {
    const task = { callback, start: vi.fn(), destroy: vi.fn() }; mocks.tasks.push(task); return task;
  },
}));
import { CronScheduler } from "../../server/cron/scheduler";
import { registerCronJobRoutes } from "../../server/modules/system/cron";
const envelope = { config: { id: "config", pluginId: "job", enabled: true, pluginKind: "cron", data: {} }, subsidiary: { schedule: "* * * * *" } };
const settle = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
let scheduler: CronScheduler;
const tx = {};
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  vi.resetAllMocks(); mocks.tasks.length = 0; mocks.maintenance = false;
  mocks.claim.mockResolvedValue(true); mocks.renew.mockResolvedValue(true);
  mocks.release.mockResolvedValue(undefined);
  mocks.guarded.mockImplementation(async (_id, fn) => fn(tx));
  mocks.search.mockResolvedValue([envelope]); mocks.get.mockResolvedValue(envelope);
  mocks.create.mockResolvedValue({ id: "run" }); mocks.update.mockResolvedValue({});
  mocks.execute.mockResolvedValue({});
  scheduler = new CronScheduler(); scheduler.setOwnership(true);
});
afterEach(async () => { await scheduler.stop(); vi.useRealTimers(); });
it("records contention without admitting running history or invoking recovery", async () => {
  mocks.claim.mockResolvedValue(false);
  expect(await scheduler.manualRun("config")).toBe("run");
  expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ status: "skipped" }));
  expect(mocks.recover).not.toHaveBeenCalled(); expect(mocks.execute).not.toHaveBeenCalled();
});
it("guards admission, recovery and completion under the same identity", async () => {
  await scheduler.manualRun("config");
  expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ status: "running" }), tx);
  expect(mocks.recover).toHaveBeenCalledWith("job", "run", tx);
  expect(mocks.update).toHaveBeenCalledWith("run", expect.objectContaining({ status: "success" }), tx);
  expect(mocks.guarded).toHaveBeenCalledTimes(3);
  expect(new Set(mocks.guarded.mock.calls.map(([id]) => id.token)).size).toBe(1);
});
it("returns the interrupted manual run and ignores a late plugin result", async () => {
  let finish!: (value: object) => void;
  mocks.execute.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const run = scheduler.manualRun("config"); await settle();
  mocks.renew.mockResolvedValue(false);
  await vi.advanceTimersByTimeAsync(5000);
  expect(await run).toBe("run");
  expect(mocks.interrupt).toHaveBeenCalledWith("run", expect.stringContaining("ownership lost"));
  finish({}); await settle();
  expect(mocks.update).not.toHaveBeenCalled();
});
it("returns HTTP 201 with the exact interrupted record through the manual route", async () => {
  mocks.manualRun.mockImplementation((...args) => scheduler.manualRun(args[0], args[1], args[2]));
  mocks.execute.mockImplementation(() => new Promise(() => {}));
  const record = { id: "run", status: "interrupted", error: "ownership lost" };
  mocks.getById.mockResolvedValue(record);
  let handler!: Function;
  registerCronJobRoutes({
    get: () => {},
    post: (_path: string, ...handlers: Function[]) => { handler = handlers.at(-1)!; },
  } as any, (() => {}) as any, (() => {}) as any);
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  const response = handler({ params: { name: "job" }, body: { mode: "test" }, user: {} }, res);
  await settle(); mocks.renew.mockResolvedValue(false);
  await vi.advanceTimersByTimeAsync(5000); await response;
  expect(res.status).toHaveBeenCalledWith(201);
  expect(res.json).toHaveBeenCalledWith(record);
  expect(mocks.getById).toHaveBeenCalledExactlyOnceWith("run");
});
it("retains ordinary plugin errors and releases ownership", async () => {
  mocks.execute.mockRejectedValue(new Error("plugin failed"));
  await expect(scheduler.manualRun("config")).rejects.toThrow("plugin failed");
  expect(mocks.update).toHaveBeenCalledWith("run", expect.objectContaining({ status: "error" }), tx);
  expect(mocks.release).toHaveBeenCalledOnce();
});
it("shares execution identity across configurations, test/live and manual/scheduled", async () => {
  let held = false;
  mocks.claim.mockImplementation(async () => { if (held) return false; held = true; return true; });
  let finish!: (value: object) => void;
  mocks.execute.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const run = scheduler.executeJob({ configurationId: "other", name: "job", schedule: "", enabled: true, settings: {} }, false);
  await settle(); await scheduler.manualRun("config", "user", "test");
  expect(mocks.claim.mock.calls.map(([id]) => id.key)).toEqual(["cron:execution:job", "cron:execution:job"]);
  expect(mocks.execute).toHaveBeenCalledOnce(); finish({}); await run;
});
it("does not publish running history before claim resolves", async () => {
  let finish!: (value: boolean) => void;
  mocks.claim.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const run = scheduler.manualRun("config"); await settle();
  expect(mocks.create).not.toHaveBeenCalled(); finish(true); await run;
});
it("refuses automatic scheduling for other roles", async () => {
  scheduler.setOwnership(false); await scheduler.start(); await scheduler.reload();
  expect(mocks.claim).not.toHaveBeenCalled();
});
it("startup does not wait for election", async () => {
  mocks.claim.mockImplementation(() => new Promise(() => {}));
  await scheduler.start(); expect(scheduler.getScheduleSummary()).toContain("standby");
});
it("revokes queued callbacks on stop and reload and during maintenance", async () => {
  await scheduler.start(); await settle();
  const first = mocks.tasks[0]; await scheduler.reload(); await first.callback();
  expect(mocks.execute).not.toHaveBeenCalled();
  mocks.maintenance = true; await mocks.tasks[1].callback();
  expect(mocks.execute).not.toHaveBeenCalled();
  await scheduler.stop(); mocks.maintenance = false; await mocks.tasks[1].callback();
  expect(mocks.execute).not.toHaveBeenCalled();
});
it("does not publish a late snapshot after lease loss", async () => {
  let finish!: (value: typeof envelope[]) => void;
  mocks.search.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await scheduler.start(); await settle(); mocks.renew.mockResolvedValue(false);
  await vi.advanceTimersByTimeAsync(5000); finish([envelope]); await settle();
  expect(mocks.tasks).toHaveLength(0);
});
it("invalidates an in-flight snapshot and reads the replacement", async () => {
  let finish!: (value: typeof envelope[]) => void;
  mocks.search.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await scheduler.start(); await settle(); scheduler.invalidateSnapshot();
  const reloaded = scheduler.reload();
  mocks.search.mockResolvedValue([{ ...envelope, config: { ...envelope.config, id: "replacement" } }]);
  finish([envelope]); await reloaded; await settle();
  await mocks.tasks[0].callback();
  expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ configurationId: "replacement" }), tx);
});
