import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  configs: [] as any[], counts: new Map<string, number>(),
  record: vi.fn(), count: vi.fn(), call: vi.fn(), farEnd: vi.fn(),
  read: vi.fn(), writeSuccess: vi.fn(), writeFailure: vi.fn(), canStore: vi.fn(),
  warn: vi.fn(), component: true, infrastructureError: false,
}));
vi.mock("../../server/storage", () => ({ storage: {
  pluginConfigs: {
    search: async () => state.configs.map(config => ({ config, subsidiary: { id: config.id } })),
    get: async (id: string) => ({ id, pluginKind: "wc-vendors", pluginId: "flood-vendor-test", enabled: true, data: {} }),
  },
  flood: {
    countEventsInWindow: (...args: unknown[]) => state.count(...args),
    recordFloodEvent: (...args: unknown[]) => state.record(...args),
  },
} }));
vi.mock("../../server/storage/configuration-revisions", () => ({
  readConfigurationSnapshot: (fn: () => unknown) => fn(),
}));
vi.mock("../../server/services/component/cache", () => ({ isComponentEnabledSync: () => state.component }));
vi.mock("../../server/modules/components", () => ({ isComponentEnabled: async () => state.component }));
vi.mock("../../server/storage/wc-stats", () => ({ wcStatsStorage: { recordCall: (...args: unknown[]) => state.call(...args) } }));
vi.mock("../../server/storage/wc-cache", async importOriginal => ({
  ...await importOriginal<typeof import("../../server/storage/wc-cache")>(),
  wcCacheStorage: {
    read: state.read, writeSuccess: state.writeSuccess,
    writeFailure: state.writeFailure, canStore: state.canStore,
  },
}));
vi.mock("../../server/logger", () => ({ logger: { info: vi.fn(), warn: state.warn, error: vi.fn(), debug: vi.fn() } }));

import { initializeFloodPluginSystem, floodPluginRegistry } from "../../server/plugins/system/flood";
import { invalidatePluginConfigCache } from "../../server/plugins/_core/plugin-config-cache";
import { registerWcVendorPlugin } from "../../server/plugins/wc-vendors/registry";
import { wcRequest } from "../../server/services/webclient";
import { WcRateLimitError } from "../../server/services/webclient/refusals";
import { getCurrentTransaction, runWithTransaction } from "../../server/storage/transaction-context";
import { setMaintenanceActive } from "../../server/services/maintenance-flag";

const OP = "tests.flood.answer";
initializeFloodPluginSystem();
registerWcVendorPlugin({
  id: "flood-vendor-test", name: "Flood Test", service: "Census",
  credential: { secretName: "none" },
  operations: {
    "service.test-connection": {
      description: "Test connection", needsWritableDatabase: false,
      run: async () => ({ status: "connected" }),
    },
    [OP]: {
      description: "Answer the test",
      cache: { mode: "cached", freshFor: 60_000, failureRememberedFor: 60_000, requestKey: () => "subject" },
      run: () => state.farEnd(),
    },
  },
} as never);
const ask = (mode = "force", connection = "vendor-a") => wcRequest({
  vendor: { configId: connection }, operation: OP, args: {}, mode,
} as never);
function rule(id: string, threshold = 1, windowSeconds = 60, extra = {}) {
  return {
    id, pluginKind: "flood", pluginId: "webclient-vendor-operation", enabled: true,
    name: id, data: { threshold, windowSeconds, vendorId: "flood-vendor-test", operation: OP },
    ...extra,
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  invalidatePluginConfigCache("flood");
  setMaintenanceActive(false);
  state.configs = [];
  state.counts.clear();
  state.component = true; state.infrastructureError = false;
  state.read.mockResolvedValue(undefined);
  state.canStore.mockResolvedValue(true);
  state.farEnd.mockResolvedValue({ answered: true, value: { ok: true } });
  state.count.mockImplementation(async (id: string) => {
    expect(getCurrentTransaction()).toBeUndefined();
    if (state.infrastructureError) throw new Error("count unavailable");
    return state.counts.get(id) ?? 0;
  });
  state.record.mockImplementation(async (id: string) => {
    expect(getCurrentTransaction()).toBeUndefined();
    state.counts.set(id, (state.counts.get(id) ?? 0) + 1);
  });
});

it("shares a rule across connections, refuses locally without fetch/cache failure/usage, and retains spent counts", async () => {
  state.configs = [rule("rule-a")];
  await ask("force", "connection-a");
  await expect(ask("force", "connection-b")).rejects.toMatchObject({
    code: "WC_RATE_LIMITED", pluginConfigurationId: "rule-a", statusCode: 429,
  });
  expect(state.farEnd).toHaveBeenCalledTimes(1);
  expect(state.call).toHaveBeenCalledTimes(1);
  expect(state.writeFailure).not.toHaveBeenCalled();
  expect(state.record).toHaveBeenCalledWith("rule-a", "webclient-vendor-operation", "global", expect.any(Date));
});
it("checks every matching rule before recording any; independent overlapping windows and other operations do not share counts", async () => {
  state.configs = [rule("minute", 2), rule("hour", 10, 3600), rule("other", 1, 60, {
    data: { threshold: 1, windowSeconds: 60, vendorId: "flood-vendor-test", operation: "other" },
  })];
  state.counts.set("hour", 10);
  await expect(ask()).rejects.toBeInstanceOf(WcRateLimitError);
  expect(state.record).not.toHaveBeenCalled();
  expect(state.farEnd).not.toHaveBeenCalled();
  expect(state.count.mock.calls.map(c => c[0])).toEqual(["minute", "hour"]);
});
it("disabled/unconfigured/component-off rules do not count, and changing a setting reuses the configuration bucket", async () => {
  state.configs = [rule("disabled", 1, 60, { enabled: false })];
  await ask();
  expect(state.count).not.toHaveBeenCalled();
  state.configs = [];
  invalidatePluginConfigCache("flood");
  await ask();
  expect(state.count).not.toHaveBeenCalled();
  state.configs = [rule("enabled")];
  state.component = false;
  // Exercise the per-plugin component guard without introducing a vendor restriction.
  const plugin = floodPluginRegistry.get("webclient-vendor-operation")!;
  const prior = plugin.requiredComponent;
  plugin.requiredComponent = "test.component";
  invalidatePluginConfigCache("flood");
  try { await ask(); } finally { plugin.requiredComponent = prior; state.component = true; }
  expect(state.count).not.toHaveBeenCalled();
  state.configs = [rule("enabled", 2)];
  invalidatePluginConfigCache("flood");
  await ask();
  state.configs[0].data.threshold = 1;
  invalidatePluginConfigCache("flood");
  await expect(ask()).rejects.toBeInstanceOf(WcRateLimitError);
});
it("counts provider failures and runs accounting outside the caller's transaction", async () => {
  state.configs = [rule("outside")];
  state.farEnd.mockRejectedValue(new Error("provider failed"));
  await runWithTransaction({} as never, async () => {
    await expect(ask()).resolves.toMatchObject({ outcome: "failure" });
  });
  expect(state.record).toHaveBeenCalledTimes(1);
  expect(state.call).toHaveBeenCalledTimes(1);
  await expect(ask()).rejects.toBeInstanceOf(WcRateLimitError);
});
it("skips accounting for fresh cache, cached-only, local, maintenance, nonwritable lookups, and failure holds", async () => {
  state.configs = [rule("skip")];
  state.read.mockResolvedValue({ outcome: "success", response: { ok: true }, fetchedAt: new Date() });
  await ask("default");
  await ask("cached-only");
  await ask("local");
  setMaintenanceActive(true);
  try { await expect(ask()).rejects.toThrow(); } finally { setMaintenanceActive(false); }
  state.read.mockResolvedValue(undefined);
  state.canStore.mockResolvedValue(false);
  await ask();
  state.canStore.mockResolvedValue(true);
  state.read.mockResolvedValue({ outcome: "failure", response: { error: "previous failure" }, fetchedAt: new Date() });
  await ask("default");
  expect(state.count).not.toHaveBeenCalled();
  expect(state.record).not.toHaveBeenCalled();
  expect(state.farEnd).not.toHaveBeenCalled();
});
it("fails open with diagnostics on infrastructure errors, but not deliberate refusals", async () => {
  state.configs = [rule("infra")];
  state.infrastructureError = true;
  await ask();
  expect(state.farEnd).toHaveBeenCalledTimes(1);
  expect(state.warn).toHaveBeenCalledWith("Vendor flood protection unavailable; allowing dispatch", expect.any(Object));
});
it("validates registry-derived vendor/operation compatibility and retains target fields through the shared adapter", async () => {
  const plugin = floodPluginRegistry.get("webclient-vendor-operation")!;
  expect(await plugin.validateConfig!(rule("r").data)).toEqual({ valid: true });
  expect((await plugin.validateConfig!({ ...rule("r").data, operation: "phone-lookup" })).valid).toBe(false);
  expect((await plugin.validateConfig!({ ...rule("r").data, threshold: 0 })).valid).toBe(false);
  const { getPluginConfigAdapter } = await import("../../server/plugins/_core/config-adapter");
  const adapter = getPluginConfigAdapter("flood")!;
  const input = adapter.configSchema.parse({ pluginId: plugin.id, enabled: true, data: rule("r").data });
  expect(adapter.toRows(input)).toMatchObject({ base: { data: rule("r").data }, subsidiary: {} });
});
