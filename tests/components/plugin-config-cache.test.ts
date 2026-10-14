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
