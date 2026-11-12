import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setEnvironmentVariableOverride } from "../../server/config/env-registry";

const mocks = vi.hoisted(() => ({
  search: vi.fn(),
  createRun: vi.fn(),
  updateRun: vi.fn(),
  acquireFence: vi.fn(),
  schedule: vi.fn(),
  execute: vi.fn(),
}));

vi.mock("node-cron", () => ({
  validate: vi.fn(() => true),
  schedule: mocks.schedule,
}));

vi.mock("../../server/storage", () => ({
  storage: {
    pluginConfigs: {
      search: mocks.search,
      getByKindAndPlugin: vi.fn(),
      getWithSubsidiary: vi.fn(),
    },
    jobRuns: {
      create: mocks.createRun,
      update: mocks.updateRun,
    },
  },
}));

vi.mock("../../server/services/s1-write-fence", () => ({
  tryAcquireAppWriteFence: mocks.acquireFence,
}));

vi.mock("../../server/services/event-bus", () => ({
  EventType: { PLUGIN_CONFIG_SAVED: "plugin-config-saved" },
  eventBus: { on: vi.fn() },
}));

vi.mock("../../server/modules/components", () => ({
  getEnabledComponentIds: vi.fn(async () => []),
}));

vi.mock("../../server/plugins/system/cron", () => ({
  cronPluginRegistry: {
    get: vi.fn(() => ({ metadata: {} })),
    has: vi.fn(() => true),
    listIds: vi.fn(() => ["test-job"]),
  },
  executeCronPlugin: mocks.execute,
}));

import { CronScheduler } from "../../server/cron/scheduler";

const originalNodeEnv = process.env.NODE_ENV;
const originalCronExecution = process.env.CRON_EXECUTION;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NODE_ENV = "production";
});

afterEach(() => {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
  if (originalCronExecution === undefined) delete process.env.CRON_EXECUTION;
  else process.env.CRON_EXECUTION = originalCronExecution;
  setEnvironmentVariableOverride("CRON_EXECUTION", null);
});

describe("CronScheduler deployment policy enforcement", () => {
  it("does not read or mutate enabled configurations when scheduling is suppressed", async () => {
    process.env.CRON_EXECUTION = "disabled";
    const scheduler = new CronScheduler();

    await scheduler.start();

    expect(mocks.search).not.toHaveBeenCalled();
    expect(mocks.schedule).not.toHaveBeenCalled();
    expect(mocks.createRun).not.toHaveBeenCalled();
    expect(scheduler.getScheduledJobCount()).toBe(0);
  });

  it("loads enabled configurations and creates timers when execution is allowed", async () => {
    process.env.CRON_EXECUTION = "enabled";
    mocks.search.mockResolvedValue([
      {
        config: {
          id: "config-1",
          pluginId: "test-job",
          enabled: true,
          data: {},
        },
        subsidiary: { schedule: "0 * * * *" },
      },
    ]);
    const task = { start: vi.fn(), stop: vi.fn() };
    mocks.schedule.mockReturnValue(task);
    const scheduler = new CronScheduler();

    await scheduler.start();

    expect(mocks.search).toHaveBeenCalledWith("cron", { enabled: true });
    expect(mocks.schedule).toHaveBeenCalledOnce();
    expect(task.start).toHaveBeenCalledOnce();
    expect(scheduler.getScheduledJobCount()).toBe(1);
  });

  it("refuses direct execution before fences or run records are acquired", async () => {
    process.env.CRON_EXECUTION = "disabled";
    const scheduler = new CronScheduler();

    await expect(
      scheduler.executeJob(
        {
          configId: "config-1",
          name: "test-job",
          schedule: "0 * * * *",
          enabled: true,
          settings: {},
        },
        true,
      ),
    ).rejects.toMatchObject({ code: "CRON_EXECUTION_SUPPRESSED" });

    expect(mocks.acquireFence).not.toHaveBeenCalled();
    expect(mocks.createRun).not.toHaveBeenCalled();
  });
  it("records a configuration-specific skipped run without executing while S1 owns the fence", async () => {
    process.env.CRON_EXECUTION = "enabled";
    mocks.acquireFence.mockResolvedValue(undefined);
    mocks.createRun.mockResolvedValue({ id: "deferred-run" });
    const result = await new CronScheduler().executeJob({
      configId: "config-2", name: "test-job", schedule: "0 * * * *", enabled: true, settings: {},
    }, true, "admin-1");
    expect(result).toBe("deferred-run");
    expect(mocks.createRun).toHaveBeenCalledWith(expect.objectContaining({
      configurationId: "config-2", pluginKind: "cron", pluginId: "test-job",
      operation: "execute", status: "skipped", triggeredBy: "admin-1",
    }));
    expect(mocks.updateRun).toHaveBeenCalledWith("deferred-run", expect.objectContaining({
      status: "skipped", output: expect.stringContaining("s1-sync-deferred"),
    }));
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("executes the selected configuration under its lease and records success in jobRuns", async () => {
    process.env.CRON_EXECUTION = "enabled";
    const release = vi.fn().mockResolvedValue(undefined);
    mocks.acquireFence.mockResolvedValue({ release });
    mocks.createRun.mockResolvedValue({ id: "live-run" });
    mocks.execute.mockResolvedValue({ message: "finished" });
    await new CronScheduler().executeJob({
      configId: "config-3", name: "test-job", schedule: "0 * * * *", enabled: true, settings: { chosen: true },
    }, true, "admin-2", "test");
    expect(mocks.execute).toHaveBeenCalledWith("test-job", expect.objectContaining({
      configurationId: "config-3", isManual: true, mode: "test", settings: { chosen: true },
    }));
    expect(mocks.updateRun).toHaveBeenCalledWith("live-run", expect.objectContaining({ status: "success" }));
    expect(release).toHaveBeenCalledOnce();
  });
  it("records plugin failure and releases the S1 lease without swallowing the error", async () => {
    process.env.CRON_EXECUTION = "enabled";
    const release = vi.fn().mockResolvedValue(undefined);
    mocks.acquireFence.mockResolvedValue({ release });
    mocks.createRun.mockResolvedValue({ id: "failed-run" });
    mocks.execute.mockRejectedValue(new Error("plugin failed"));
    await expect(new CronScheduler().executeJob({
      configId: "config-4", name: "test-job", schedule: "0 * * * *", enabled: true, settings: {},
    }, true)).rejects.toThrow("plugin failed");
    expect(mocks.updateRun).toHaveBeenCalledWith("failed-run", expect.objectContaining({
      status: "error", error: "plugin failed",
    }));
    expect(release).toHaveBeenCalledOnce();
  });
});