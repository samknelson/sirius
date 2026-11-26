import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  search: vi.fn(), count: vi.fn(), record: vi.fn(), component: vi.fn(),
  get: vi.fn(), admin: true,
}));
vi.mock("../../server/storage", () => ({ storage: {
  pluginConfigs: { search: mocks.search, getWithSubsidiary: mocks.get },
  flood: { countEventsInWindow: mocks.count, recordFloodEvent: mocks.record },
} }));
vi.mock("../../server/storage/configuration-revisions", () => ({
  readConfigurationSnapshot: (fn: () => unknown) => fn(),
}));
vi.mock("../../server/storage/system/plugin-configs", () => ({
  SingletonViolationError: class SingletonViolationError extends Error {},
}));
vi.mock("../../server/plugins/_core/singleton-seeder", () => ({
  ensureSingletonPluginConfig: async (_kind: string, id: string) => ({
    config: { id: `config-${id}`, pluginId: id, enabled: true,
      data: id === "local-login" ? { threshold: 10, windowSeconds: 900 } : { threshold: 20, windowSeconds: 3600 } },
    created: false,
  }),
}));
vi.mock("../../server/modules/components", () => ({ isComponentEnabled: mocks.component }));
vi.mock("../../server/services/component/cache", () => ({
  isComponentEnabledSync: () => true,
}));
vi.mock("../../server/services/access-policy-evaluator", () => ({
  checkAccessInline: async () => ({ granted: mocks.admin, reason: "Admin required" }),
}));
import { initializeFloodPluginSystem, floodPluginRegistry } from "../../server/plugins/system/flood";
import { checkFlood, recordFloodEvent, enforceFloodLimit, FloodError, resolveFloodIdentifierNames } from "../../server/flood/service";
import { invalidatePluginConfigCache } from "../../server/plugins/_core/plugin-config-cache";
import { getPluginKind, isSingletonPluginType } from "../../server/plugins/_core/kinds";
import { getPluginConfigAdapter } from "../../server/plugins/_core/config-adapter";
import { registerPluginsConfigRoutes } from "../../server/modules/system/plugins-config";
import { registerFloodPlugin } from "../../server/plugins/system/flood/registry";

initializeFloodPluginSystem();
registerFloodPlugin({
  id: "fixture-resource", name: "Fixture resource", description: "Component limiter fixture",
  requiredComponent: "fixture-component", singleton: true,
  defaults: { threshold: 30, windowSeconds: 900 },
  getIdentifier: context => `${context.resourceId}|${context.ip}`,
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.admin = true;
  mocks.component.mockResolvedValue(true);
  mocks.search.mockResolvedValue([]);
  mocks.count.mockResolvedValue(0);
  mocks.record.mockResolvedValue(undefined);
  invalidatePluginConfigCache("flood");
});
const config = (enabled: boolean, data = { threshold: 2, windowSeconds: 60 }) =>
  [{ config: { id: "config-local-login", pluginId: "local-login", enabled, data } }];

describe("singleton flood plugins", () => {
  it("registers every legacy identity with singleton metadata, gates and defaults", async () => {
    expect(floodPluginRegistry.listIds().sort()).toEqual([
      "bookmark", "fixture-resource", "local-login", "local-password-change",
      "notification-email", "notification-inapp", "notification-postal", "notification-sms",
      "quicksearch",
      "webclient-vendor-operation",
    ]);
    for (const plugin of floodPluginRegistry.list()) {
      expect(isSingletonPluginType("flood", plugin.id)).toBe(plugin.singleton);
      expect(plugin.description).not.toBe("");
      const entry = floodPluginRegistry.toManifestEntry(plugin);
      expect((entry.configSchema.properties?.threshold as { default: number }).default).toBe(plugin.defaults.threshold);
      const seeded = getPluginConfigAdapter("flood")!.seedDefault!(plugin);
      if (!plugin.singleton) { expect(seeded).toBeNull(); continue; }
      expect(seeded.enabled).toBe(true);
      expect(seeded.data).toEqual(plugin.defaults);
    }
    const kind = getPluginKind("flood")!;
    expect(kind.requiredPolicy).toBe("admin");
    expect(kind.requiredComponent).toBeUndefined();
    expect(floodPluginRegistry.get("fixture-resource")!.requiredComponent).toBe("fixture-component");
    expect(floodPluginRegistry.get("local-login")!.requiredComponent).toBeUndefined();
    expect((await kind.validateConfig!({} as never, { threshold: 0, windowSeconds: 1 })).valid).toBe(false);
    expect((await kind.validateConfig!({} as never, { threshold: 1.5, windowSeconds: 1 })).valid).toBe(false);
    expect((await kind.validateConfig!({} as never, { threshold: 1, windowSeconds: 60 })).valid).toBe(true);
    expect(getPluginConfigAdapter("flood")!.toRows({
      pluginId: "local-login", enabled: false, name: "Custom", ordering: 7,
      siriusId: "custom-alias", data: { threshold: 12, windowSeconds: 34 },
    }).base).toMatchObject({
      pluginKind: "flood", pluginId: "local-login", enabled: false, name: "Custom",
      ordering: 7, siriusId: "custom-alias", data: { threshold: 12, windowSeconds: 34 },
    });
  });

  it("bypasses disabled plugins even with missing identifiers and broken count storage", async () => {
    mocks.search.mockResolvedValue(config(false));
    mocks.count.mockRejectedValue(new Error("Must not count"));
    mocks.record.mockRejectedValue(new Error("Must not record"));
    expect(await checkFlood("local-login", {})).toEqual({ allowed: true, skipped: true, reason: "disabled" });
    await recordFloodEvent("local-login", {});
    await enforceFloodLimit("local-login", {});
    expect(mocks.count).not.toHaveBeenCalled();
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it("bypasses component-off plugins before reading config or validating context", async () => {
    mocks.component.mockResolvedValue(false);
    mocks.search.mockRejectedValue(new Error("Must not read configs"));
    for (const id of ["fixture-resource"]) {
      expect(await checkFlood(id, {})).toEqual({ allowed: true, skipped: true, reason: "component-disabled" });
      await recordFloodEvent(id, {});
      await enforceFloodLimit(id, {});
    }
    expect(mocks.search).not.toHaveBeenCalled();
    expect(mocks.count).not.toHaveBeenCalled();
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it("uses code defaults for absent configs, with unchanged compound bucket keys", async () => {
    const result = await checkFlood("local-login", { email: "fixture", ip: "127.0.0.1" });
    expect(result).toMatchObject({ allowed: true, threshold: 10, windowSeconds: 900, identifier: "fixture|127.0.0.1" });
    await recordFloodEvent("notification-sms", { contactId: "c", pluginId: "p" });
    expect(mocks.record).toHaveBeenCalledWith("config-notification-sms", "notification-sms", "c|p", expect.any(Date));
    expect(floodPluginRegistry.get("bookmark")!.defaults).toEqual({ threshold: 1000, windowSeconds: 360 });
    expect(floodPluginRegistry.get("quicksearch")!.getIdentifier({ ip: "ip" })).toBe("ip");
  });

  it("refreshes disablement, enablement and limits without discarding counts", async () => {
    mocks.count.mockResolvedValue(2);
    mocks.search.mockResolvedValue(config(true));
    await expect(enforceFloodLimit("local-login", { email: "e", ip: "i" })).rejects.toBeInstanceOf(FloodError);
    mocks.search.mockResolvedValue(config(false));
    invalidatePluginConfigCache("flood");
    await enforceFloodLimit("local-login", {});
    mocks.search.mockResolvedValue(config(true));
    invalidatePluginConfigCache("flood");
    expect((await checkFlood("local-login", { email: "e", ip: "i" })).allowed).toBe(false);
    mocks.search.mockResolvedValue(config(true, { threshold: 3, windowSeconds: 90 }));
    invalidatePluginConfigCache("flood");
    await enforceFloodLimit("local-login", { email: "e", ip: "i" });
    expect(mocks.record).toHaveBeenCalledTimes(1);
    expect(mocks.record).toHaveBeenLastCalledWith("config-local-login", "local-login", "e|i", expect.any(Date));
  });

  it("keeps unknown ids, malformed active settings and read failures explicit", async () => {
    await expect(checkFlood("typo", {})).rejects.toThrow("Unknown flood event");
    await expect(recordFloodEvent("typo", {})).rejects.toThrow("Unknown flood event");
    mocks.search.mockRejectedValue(new Error("Config read failed"));
    await expect(checkFlood("local-login", {})).rejects.toThrow("Config read failed");
    mocks.search.mockResolvedValue(config(true, { threshold: -1, windowSeconds: 1 }));
    await expect(checkFlood("local-login", {})).rejects.toThrow();
  });

  it("keeps disabled, component-off and retired history readable without callbacks", async () => {
    mocks.search.mockResolvedValue(config(false));
    mocks.component.mockResolvedValue(false);
    const names = await resolveFloodIdentifierNames([
      { event: "local-login", identifier: "not-an-email", pluginConfigurationId: "config-local-login" },
      { event: "fixture-resource", identifier: "s|ip", pluginConfigurationId: "config-resource" },
      { event: "retired", identifier: "raw", pluginConfigurationId: "retired-config" },
    ]);
    expect(names.size).toBe(0);
    expect(mocks.count).not.toHaveBeenCalled();
  });

  it("filters component-owned plugins from the real manifest, not core limiters", async () => {
    mocks.component.mockImplementation(async (id: string) => id !== "fixture-component");
    const visible = await floodPluginRegistry.listVisibleTo({} as never);
    expect(visible.some(p => p.id === "fixture-resource")).toBe(false);
    expect(visible.some(p => p.id === "local-login")).toBe(true);
  });

  it("enforces admin and component gates on direct generic config read/edit routes", async () => {
    const handlers = new Map<string, any>();
    const register = (verb: string) => (path: string, ...callbacks: any[]) => handlers.set(`${verb} ${path}`, callbacks.at(-1));
    registerPluginsConfigRoutes({
      get: register("GET"), post: register("POST"), patch: register("PATCH"), delete: register("DELETE"),
    } as never, vi.fn());
    const req = { params: { kind: "flood", id: "fixture" }, body: { enabled: false } };
    const response = () => ({ status: vi.fn().mockReturnThis(), json: vi.fn() });
    mocks.get.mockResolvedValue({ config: {
      id: "fixture", pluginKind: "flood", pluginId: "fixture-resource",
      enabled: true, data: { threshold: 30, windowSeconds: 900 },
    } });
    mocks.admin = false;
    const nonAdmin = response();
    await handlers.get("GET /api/plugins/:kind/configs/:id")(req, nonAdmin);
    expect(nonAdmin.status).toHaveBeenCalledWith(403);
    expect(mocks.get).not.toHaveBeenCalled();
    // A non-admin's actual flood checks still run, independent of UI access.
    expect((await checkFlood("local-login", { email: "e", ip: "i" })).allowed).toBe(true);
    expect(mocks.count).toHaveBeenCalled();
    mocks.admin = true;
    mocks.component.mockResolvedValue(false);
    for (const verb of ["GET", "PATCH"]) {
      const res = response();
      await handlers.get(`${verb} /api/plugins/:kind/configs/:id`)(req, res);
      expect(res.status.mock.calls[0][0]).toBeGreaterThanOrEqual(400);
      expect(res.json).not.toHaveBeenCalledWith(expect.objectContaining({ pluginKind: "flood" }));
    }
  });
});
