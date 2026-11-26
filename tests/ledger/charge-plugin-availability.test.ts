import { beforeEach, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({
  search: vi.fn(), enabled: vi.fn(), plugin: vi.fn(), available: vi.fn(),
}));
vi.mock("../../server/storage", () => ({ storage: { pluginConfigs: { search: f.search } } }));
vi.mock("../../server/logger", () => ({ logger: { debug: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock("../../server/plugins/ledger/charge/registry", () => ({
  getEnabledChargePluginsByTrigger: f.enabled, getChargePlugin: f.plugin, isChargePluginEnabled: f.available,
}));
import { executeChargePlugins } from "../../server/plugins/ledger/charge/executor";
import { TriggerType, type PluginContext } from "../../server/plugins/ledger/charge/types";
const context = { trigger: TriggerType.CRON } as PluginContext;
const config = (id: string, pluginId: string, scope = "global") => ({
  config: { id, pluginId, enabled: true, data: {} },
  subsidiary: { scope, employerId: scope === "employer" ? "employer" : null, account: "shared-account" },
});
beforeEach(() => {
  vi.resetAllMocks();
  f.enabled.mockResolvedValue([]);
  f.search.mockResolvedValue([config("configured", "optional-charge")]);
});

it("reports a retained configuration whose plugin source is missing", async () => {
  const result = await executeChargePlugins(context);
  expect(result.executed).toEqual([expect.objectContaining({
    pluginId: "optional-charge", success: false, error: expect.stringContaining("unavailable"),
  })]);
  expect(result.totalTransactions).toEqual([]);
});

it("reports a configured plugin whose component requirements are unavailable", async () => {
  const plugin = { canHandle: () => true, execute: vi.fn() };
  f.plugin.mockReturnValue(plugin);
  f.available.mockResolvedValue(false);
  const result = await executeChargePlugins(context);
  expect(result.executed[0]).toMatchObject({ pluginId: "optional-charge", success: false });
  expect(plugin.execute).not.toHaveBeenCalled();
});

it("batches scoped reads and keeps account overrides isolated by plugin", async () => {
  const plugin = (id: string) => ({
    metadata: { id }, canHandle: () => true,
    execute: vi.fn().mockResolvedValue({ success: true, transactions: [] }),
  });
  const first = plugin("first");
  const second = plugin("second");
  f.plugin.mockImplementation(id => id === "first" ? first : second);
  f.available.mockResolvedValue(true);
  f.enabled.mockResolvedValue([first, second]);
  f.search.mockImplementation((_kind, query) => Promise.resolve(query.scope === "global"
    ? [config("global-first", "first"), config("global-second", "second")]
    : [config("employer-first", "first", "employer")]));
  const result = await executeChargePlugins({ ...context, employerId: "employer" } as PluginContext);
  expect(first.execute).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: "employer-first" }));
  expect(second.execute).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: "global-second" }));
  expect(f.search).toHaveBeenCalledTimes(2);
  expect(result.executed.every(row => row.success)).toBe(true);
});
