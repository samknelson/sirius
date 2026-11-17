import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connect: vi.fn(), search: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(),
  execute: vi.fn(), tasks: [] as { callback: () => Promise<void>; start: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }[],
  maintenance: false,
}));
vi.mock("../../server/storage", () => ({
  storage: {
    pluginConfigs: { search: mocks.search, getWithSubsidiary: mocks.get },
    jobRuns: { create: mocks.create, update: mocks.update },
  },
}));
vi.mock("../../server/storage/db", () => ({ pool: { connect: mocks.connect } }));
vi.mock("../../server/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("../../server/plugins/system/cron", () => ({
  cronPluginRegistry: { has: () => true, get: () => ({ metadata: {} }) },
  executeCronPlugin: mocks.execute,
}));
vi.mock("../../server/modules/components", () => ({ getEnabledComponentIds: async () => [] }));
vi.mock("../../server/storage/configuration-revisions", () => ({ readConfigurationSnapshot: (read: () => unknown) => read() }));
vi.mock("../../server/services/maintenance-flag", () => ({ isMaintenanceActive: () => mocks.maintenance }));
vi.mock("node-cron", () => ({
  validate: () => true,
  createTask: (_schedule: string, callback: () => Promise<void>) => {
    const task = { callback, start: vi.fn(), destroy: vi.fn() };
    mocks.tasks.push(task);
    return task;
  },
}));
import { CronScheduler } from "../../server/cron/scheduler";
import { CRON_RETRY_MAX_MS } from "../../server/cron/ownership";
import { runOrDeferStartupOperation, runDeferredStartupOperations, resetStartupDeferralsForTest } from "../../server/services/startup-deferrals";

const envelope = { config: { id: "config", pluginId: "job", enabled: true, pluginKind: "cron", data: {} }, subsidiary: { schedule: "* * * * *" } };
const schedulers: CronScheduler[] = [];
const settle = async () => { for (let i = 0; i < 25; i++) await Promise.resolve(); };
function setup() {
  const client = Object.assign(new EventEmitter(), {
    query: vi.fn(async () => ({ rows: [{ acquired: true }] })),
    release: vi.fn(),
  });
  mocks.connect.mockResolvedValue(client);
  const scheduler = new CronScheduler();
  scheduler.setOwnership(true);
  schedulers.push(scheduler);
  return { scheduler, client };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  mocks.tasks.length = 0;
  mocks.maintenance = false;
  resetStartupDeferralsForTest();
  mocks.search.mockResolvedValue([envelope]);
  mocks.get.mockResolvedValue(envelope);
  mocks.create.mockResolvedValue({ id: "run" });
  mocks.update.mockResolvedValue({});
  mocks.execute.mockResolvedValue({});
});
afterEach(async () => {
  await Promise.all(schedulers.splice(0).map(scheduler => scheduler.stop()));
  vi.useRealTimers();
});

describe("automatic cron execution authority", () => {
  it("uses the same execution key across scheduled/manual, configurations and test/live runs", async () => {
    const { scheduler } = setup();
    let held = false;
    const keys: unknown[] = [];
    mocks.connect.mockImplementation(async () => Object.assign(new EventEmitter(), {
      query: async (_text: string, key: unknown) => {
        keys.push(key);
        const acquired = !held;
        if (acquired) held = true;
        return { rows: [{ acquired }] };
      },
      release: () => {},
    }));
    let finish!: (value: object) => void;
    mocks.execute.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const first = scheduler.executeJob({ configurationId: "a", name: "job", enabled: true, schedule: "* * * * *", settings: {} }, false);
    await settle();
    mocks.get.mockResolvedValue({ ...envelope, config: { ...envelope.config, id: "b" } });
    await scheduler.manualRun("b", "user", "test");
    expect(mocks.execute).toHaveBeenCalledOnce();
    expect(keys).toHaveLength(2);
    expect(keys[0]).toEqual(keys[1]);
    expect(mocks.update).toHaveBeenCalledWith("run", expect.objectContaining({ status: "skipped" }));
    finish({});
    await first;
  });

  it("records lock contention as skipped without invoking the plugin", async () => {
    const { scheduler, client } = setup();
    client.query.mockResolvedValue({ rows: [{ acquired: false }] });
    await scheduler.manualRun("config", "user", "test");
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.update).toHaveBeenCalledWith("run", expect.objectContaining({
      status: "skipped", output: JSON.stringify({ message: "Skipped: job already running." }),
    }));
  });

  it("marks lock loss interrupted even when the plugin has not returned", async () => {
    const { scheduler, client } = setup();
    let finish!: (result: object) => void;
    mocks.execute.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const run = scheduler.manualRun("config", "user");
    const result = expect(run).rejects.toThrow("lock lost");
    await settle();
    client.emit("end");
    await result;
    finish({});
    await settle();
    expect(mocks.update).toHaveBeenCalledWith("run", expect.objectContaining({ status: "interrupted" }));
    expect(mocks.update.mock.calls.some(([, update]) => update.status === "success")).toBe(false);
  });

  it("cleans up execution locks on plugin failure", async () => {
    const { scheduler, client } = setup();
    mocks.execute.mockRejectedValue(new Error("plugin failure"));
    await expect(scheduler.manualRun("config")).rejects.toThrow("plugin failure");
    expect(client.release).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("never competes or starts timers in a non-owning role, including reload", async () => {
    const { scheduler } = setup();
    scheduler.setOwnership(false);
    await scheduler.start();
    await scheduler.reload();
    expect(mocks.connect).not.toHaveBeenCalled();
    expect(mocks.tasks).toHaveLength(0);
  });

  it("returns from startup while the election is still pending", async () => {
    const { scheduler } = setup();
    mocks.connect.mockImplementation(() => new Promise(() => {}));
    await scheduler.start();
    expect(scheduler.isStarted()).toBe(true);
    expect(scheduler.getScheduleSummary()).toContain("standby");
    expect(mocks.tasks).toHaveLength(0);
  });

  it("does not enter election during maintenance startup deferral, but starts after exit", async () => {
    const { scheduler } = setup();
    mocks.maintenance = true;
    expect(await runOrDeferStartupOperation("cron-scheduler-start", () => scheduler.start())).toBe("deferred");
    await scheduler.reload();
    expect(scheduler.isStarted()).toBe(false);
    expect(mocks.connect).not.toHaveBeenCalled();
    mocks.maintenance = false;
    await runDeferredStartupOperations();
    await settle();
    expect(scheduler.isStarted()).toBe(true);
    expect(mocks.connect).toHaveBeenCalledOnce();
    expect(scheduler.getScheduledJobCount()).toBe(1);
  });

  it("destroys timers and rejects already-queued callbacks immediately on ownership loss", async () => {
    const { scheduler, client } = setup();
    await scheduler.start();
    await settle();
    const [task] = mocks.tasks;
    client.emit("error", new Error("lost"));
    expect(task.destroy).toHaveBeenCalledOnce();
    await task.callback();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("does not publish a configuration read that completes after losing ownership", async () => {
    const { scheduler, client } = setup();
    let finish!: (value: typeof envelope[]) => void;
    mocks.search.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await scheduler.start();
    await settle();
    client.emit("end");
    finish([envelope]);
    await settle();
    expect(mocks.tasks).toHaveLength(0);
    expect(scheduler.getScheduledJobCount()).toBe(0);
  });

  it("discards an invalidated in-flight snapshot and publishes the replacement", async () => {
    const { scheduler } = setup();
    let finish!: (value: typeof envelope[]) => void;
    mocks.search.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await scheduler.start();
    await settle();
    scheduler.invalidateSnapshot();
    const reloaded = scheduler.reload();
    mocks.search.mockResolvedValue([{ ...envelope, config: { ...envelope.config, id: "replacement" } }]);
    finish([envelope]);
    await reloaded;
    await settle();
    expect(mocks.tasks).toHaveLength(1);
    await mocks.tasks[0].callback();
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ configurationId: "replacement" }));
  });

  it("can regain ownership while an old configuration read is still stalled", async () => {
    const { scheduler, client } = setup();
    let finish!: (value: typeof envelope[]) => void;
    mocks.search.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await scheduler.start();
    await settle();
    client.emit("end");
    const replacement = Object.assign(new EventEmitter(), {
      query: vi.fn(async () => ({ rows: [{ acquired: true }] })),
      release: vi.fn(),
    });
    mocks.connect.mockResolvedValue(replacement);
    mocks.search.mockResolvedValue([{ ...envelope, config: { ...envelope.config, id: "replacement" } }]);
    await vi.advanceTimersByTimeAsync(CRON_RETRY_MAX_MS);
    expect(scheduler.getScheduledJobCount()).toBe(1);
    finish([envelope]);
    await settle();
    expect(mocks.tasks).toHaveLength(1);
    await mocks.tasks[0].callback();
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ configurationId: "replacement" }));
  });

  it("reads current configuration at takeover and never revives the former owner's callbacks", async () => {
    const { scheduler, client } = setup();
    client.query.mockResolvedValue({ rows: [{ acquired: false }] });
    await scheduler.start();
    await settle();
    await scheduler.reload();
    expect(mocks.search).not.toHaveBeenCalled();
    client.query.mockResolvedValue({ rows: [{ acquired: true }] });
    mocks.search.mockResolvedValue([{ ...envelope, config: { ...envelope.config, id: "new" } }]);
    await vi.advanceTimersByTimeAsync(CRON_RETRY_MAX_MS);
    expect(mocks.search).toHaveBeenCalledOnce();
    await mocks.tasks[0].callback();
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ configurationId: "new" }));
  });

  it("invalidates replaced timers on reload and suppresses automatic starts during maintenance", async () => {
    const { scheduler } = setup();
    await scheduler.start();
    await settle();
    const first = mocks.tasks[0];
    await scheduler.reload();
    await first.callback();
    expect(mocks.create).not.toHaveBeenCalled();
    mocks.maintenance = true;
    await mocks.tasks[1].callback();
    expect(mocks.create).not.toHaveBeenCalled();
    mocks.maintenance = false;
    await mocks.tasks[1].callback();
    expect(mocks.execute).toHaveBeenCalledOnce();
  });

  it("does not execute the plugin if authority is lost while creating its run record", async () => {
    const { scheduler, client } = setup();
    await scheduler.start();
    await settle();
    mocks.create.mockImplementationOnce(async () => {
      client.emit("end");
      return { id: "run" };
    });
    await mocks.tasks[0].callback();
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.update).toHaveBeenCalledWith("run", expect.objectContaining({ status: "skipped" }));
  });

  it("allows manual execution without scheduler ownership", async () => {
    const { scheduler } = setup();
    scheduler.setOwnership(false);
    await scheduler.manualRun("config", "user");
    expect(mocks.connect).toHaveBeenCalledOnce();
    expect(mocks.execute).toHaveBeenCalledWith("job", expect.objectContaining({ isManual: true, triggeredBy: "user" }), expect.any(Function));
  });

  it("keeps reload and role revocation from restarting a stopped scheduler", async () => {
    const { scheduler } = setup();
    await scheduler.start();
    await settle();
    scheduler.setOwnership(false);
    await scheduler.reload();
    await vi.advanceTimersByTimeAsync(CRON_RETRY_MAX_MS * 3);
    expect(scheduler.isStarted()).toBe(false);
    expect(scheduler.getScheduledJobCount()).toBe(0);
    expect(mocks.connect).toHaveBeenCalledOnce();
  });
});
