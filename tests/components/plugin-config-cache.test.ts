import { beforeEach, expect, it, vi } from "vitest";

const search = vi.hoisted(() => vi.fn());
vi.mock("../../server/storage/configuration-revisions", () => ({
  readConfigurationSnapshot: (fn: () => unknown) => fn(),
}));
vi.mock("../../server/storage", () => ({ storage: { pluginConfigs: { search } } }));
vi.mock("../../server/logger", () => ({ logger: { info: vi.fn() } }));
vi.mock("../../server/services/event-bus", () => ({ eventBus: {}, EventType: {} }));
beforeEach(() => { vi.resetModules(); search.mockReset(); });

it("invalidates every known kind when another process changes component state", async () => {
  const c = await import("../../server/plugins/_core/plugin-config-cache");
  search.mockResolvedValue([]);
  await c.getEnabledConfigsForKind("cron");
  await c.getEnabledConfigsForKind("event-notifier");
  expect(search).toHaveBeenCalledTimes(2);
  c.invalidateAllPluginConfigCaches();
  await c.getEnabledConfigsForKind("cron");
  await c.getEnabledConfigsForKind("event-notifier");
  expect(search).toHaveBeenCalledTimes(4);
});

it("does not return or cache an obsolete in-flight config snapshot", async () => {
  const c = await import("../../server/plugins/_core/plugin-config-cache");
  let finish!: (value: unknown) => void;
  search.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const oldRead = c.getEnabledConfigsForKind("cron");
  await vi.waitFor(() => expect(search).toHaveBeenCalledOnce());
  c.invalidateAllPluginConfigCaches();
  search.mockResolvedValueOnce([{ id: "confirmed" }]);
  const fresh = await c.getEnabledConfigsForKind("cron");
  finish([{ id: "obsolete" }]);
  expect(await oldRead).toEqual(fresh);
  expect(await c.getEnabledConfigsForKind("cron")).toEqual([{ id: "confirmed" }]);
});

it("separates all-config and enabled snapshots and invalidates both together", async () => {
  const c = await import("../../server/plugins/_core/plugin-config-cache");
  const disabled = { config: { id: "disabled", enabled: false } };
  search.mockImplementation(async (_kind, filter) => filter.enabled ? [] : [disabled]);
  expect(await c.getEnabledConfigsForKind("flood")).toEqual([]);
  expect(await c.getConfigsForKind("flood")).toEqual([disabled]);
  await c.getConfigsForKind("flood");
  expect(search).toHaveBeenCalledTimes(2);
  c.invalidateAllPluginConfigCaches();
  await c.getConfigsForKind("flood");
  await c.getEnabledConfigsForKind("flood");
  expect(search).toHaveBeenCalledTimes(4);
  c.invalidatePluginConfigCache("flood");
  await c.getConfigsForKind("flood");
  expect(search).toHaveBeenCalledTimes(5);
});

it("discards obsolete all-config reads after same-kind invalidation", async () => {
  const c = await import("../../server/plugins/_core/plugin-config-cache");
  let finish!: (value: unknown) => void;
  search.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const oldRead = c.getConfigsForKind("flood");
  await vi.waitFor(() => expect(search).toHaveBeenCalledOnce());
  c.invalidatePluginConfigCache("flood");
  search.mockResolvedValueOnce([{ config: { enabled: false } }]);
  const fresh = await c.getConfigsForKind("flood");
  finish([{ config: { enabled: true } }]);
  expect(await oldRead).toEqual(fresh);
});
