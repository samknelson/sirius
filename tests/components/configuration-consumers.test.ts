import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  variables: vi.fn(), search: vi.fn(), prefix: vi.fn(), mode: vi.fn(),
  acquire: vi.fn(), defer: vi.fn(), createTask: vi.fn(),
}));
vi.mock("../../server/storage", () => ({
  storage: { variables: { getByName: mocks.variables, getByNamePrefix: mocks.prefix }, pluginConfigs: { search: mocks.search } },
}));
vi.mock("../../server/storage/configuration-revisions", () => ({
  readConfigurationSnapshot: (fn: () => unknown) => fn(),
}));
vi.mock("../../server/storage/db", () => ({ registerPoolCheckoutInitializer: mocks.acquire }));
vi.mock("../../server/storage/transaction-context", () => ({ runOutsideTransaction: (fn: () => unknown) => fn() }));
vi.mock("../../server/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("../../server/services/system-mode", () => ({
  getSystemMode: mocks.mode, isMaintenanceMode: (mode: string) => mode === "maintenance",
}));
vi.mock("../../server/services/startup-deferrals", () => ({ runDeferredStartupOperations: mocks.defer }));
vi.mock("../../server/plugins/system/cron", () => ({
  cronPluginRegistry: { has: () => true }, executeCronPlugin: vi.fn(),
}));
vi.mock("../../server/modules/components", () => ({ getEnabledComponentIds: vi.fn() }));
// Scheduling authority is a database-backed lease elected asynchronously after
// start(); stand in an always-granted lease so these tests cover scheduling.
vi.mock("../../server/cron/execution-lock", () => ({
  CronExecutionLock: {
    acquireKey: vi.fn(async () => ({
      assertOwned: () => {}, close: async () => {}, lost: new Promise<never>(() => {}),
    })),
  },
  CronExecutionLost: class extends Error {},
}));
vi.mock("node-cron", () => ({ validate: (s: string) => !!s && s !== "not-a-cron", createTask: mocks.createTask }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.mode.mockResolvedValue("live");
  mocks.search.mockResolvedValue([]);
  mocks.defer.mockResolvedValue(undefined);
});

it("does not allow an old environment override snapshot to undo a rename/deletion", async () => {
  const c = await import("../../server/services/env-overrides");
  let finish!: (rows: unknown[]) => void;
  mocks.prefix.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const old = c.refreshEnvOverrides();
  c.invalidateEnvOverrideSnapshot();
  mocks.prefix.mockResolvedValueOnce([{ name: "ENV_NEW", value: "new" }]);
  await c.refreshEnvOverrides();
  finish([{ name: "ENV_OLD", value: "old" }]);
  await old;
  expect([...c.getEnvOverrideMap()]).toEqual([["NEW", "new"]]);
  mocks.prefix.mockResolvedValue([]);
  await c.refreshEnvOverrides();
  expect(c.getEnvOverrideMap().size).toBe(0);
});

it("keeps maintenance armed on database failure and rejects an obsolete exit snapshot", async () => {
  const c = await import("../../server/services/maintenance-mode");
  const flag = await import("../../server/services/maintenance-flag");
  mocks.mode.mockResolvedValueOnce("maintenance");
  await c.armMaintenanceEnforcement();
  expect(flag.isMaintenanceActive()).toBe(true);
  mocks.mode.mockRejectedValueOnce(new Error("db offline"));
  await expect(c.refreshMaintenanceFlag()).rejects.toThrow("db offline");
  expect(flag.isMaintenanceActive()).toBe(true);
  let finish!: (mode: string) => void;
  mocks.mode.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const old = c.refreshMaintenanceFlag();
  c.invalidateMaintenanceSnapshot();
  mocks.mode.mockResolvedValueOnce("maintenance");
  await c.refreshMaintenanceFlag();
  finish("live");
  await old;
  expect(flag.isMaintenanceActive()).toBe(true);
  expect(mocks.defer).not.toHaveBeenCalled();
  mocks.mode.mockResolvedValueOnce("live");
  await c.refreshMaintenanceFlag();
  expect(flag.isMaintenanceActive()).toBe(false);
  expect(mocks.defer).toHaveBeenCalledOnce();
});

it("never starts cron in a non-owning role and discards an obsolete schedule load", async () => {
  const { cronScheduler: c } = await import("../../server/cron/scheduler");
  await c.start();
  await c.reload();
  expect(mocks.search).not.toHaveBeenCalled();
  c.setOwnership(true);
  let finish!: (rows: unknown[]) => void;
  mocks.search.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  await c.start();
  // Ownership is acquired in the background; the first load is now in flight.
  await vi.waitFor(() => expect(mocks.search).toHaveBeenCalledOnce());
  c.invalidateSnapshot();
  const task = { start: vi.fn(), destroy: vi.fn() };
  mocks.createTask.mockReturnValue(task);
  mocks.search.mockResolvedValueOnce([{
    config: { id: "new", pluginId: "new", enabled: true, data: {} }, subsidiary: { schedule: "* * * * *" },
  }]);
  finish([{ config: { id: "old", pluginId: "old" }, subsidiary: { schedule: "* * * * *" } }]);
  await vi.waitFor(() => expect(c.isJobScheduled("new")).toBe(true));
  expect(c.isJobScheduled("old")).toBe(false);
  expect(c.isJobScheduled("new")).toBe(true);
  expect(task.start).toHaveBeenCalledOnce();
  mocks.search.mockRejectedValueOnce(new Error("db offline"));
  await expect(c.reload()).rejects.toThrow("db offline");
  expect(c.isJobScheduled("new")).toBe(true);
  mocks.search.mockResolvedValueOnce([]);
  await c.reload();
  expect(c.getScheduledJobCount()).toBe(0);
  await c.stop();
});

it("isolates a persisted invalid cron expression at startup and refreshes healthy jobs on reload", async () => {
  const { cronScheduler: c } = await import("../../server/cron/scheduler");
  c.setOwnership(true);
  const job = (id: string, schedule: string) => ({
    config: { id, pluginId: id, enabled: true, data: {} }, subsidiary: { schedule },
  });
  const firstTask = { start: vi.fn(), destroy: vi.fn() };
  const secondTask = { start: vi.fn(), destroy: vi.fn() };
  mocks.createTask.mockReturnValueOnce(firstTask).mockReturnValueOnce(secondTask);
  mocks.search.mockResolvedValueOnce([job("invalid", "not-a-cron"), job("healthy", "* * * * *")]);
  await expect(c.start()).resolves.toBeUndefined();
  expect(c.isStarted()).toBe(true);
  await vi.waitFor(() => expect(c.isJobScheduled("healthy")).toBe(true));
  expect(c.isJobScheduled("invalid")).toBe(false);
  expect(c.isJobScheduled("healthy")).toBe(true);
  expect(c.getScheduleSummary()).toContain("invalid: invalid cron expression");
  expect(firstTask.start).toHaveBeenCalledOnce();
  mocks.search.mockResolvedValueOnce([job("invalid", "not-a-cron"), job("changed", "*/5 * * * *")]);
  await expect(c.reload()).resolves.toBeUndefined();
  expect(firstTask.destroy).toHaveBeenCalledOnce();
  expect(c.isJobScheduled("healthy")).toBe(false);
  expect(c.isJobScheduled("changed")).toBe(true);
  expect(secondTask.start).toHaveBeenCalledOnce();
  expect(c.getScheduleSummary()).toContain("1 job scheduled. Skipped jobs: invalid: invalid cron expression");
  mocks.search.mockResolvedValueOnce([]);
  await c.reload();
  expect(c.getScheduleSummary()).toBe("0 jobs scheduled.");
  await c.stop();
});
