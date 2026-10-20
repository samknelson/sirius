import type { AddressInfo } from "node:net";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  authenticated: true,
  policies: new Set(["admin", "kind-reader", "plugin-reader"]),
  components: new Set(["kind-component", "plugin-component"]),
}));

vi.mock("../../server/logger", () => ({ logger: { warn: vi.fn() } }));
vi.mock("../../server/plugins/_core", async () => {
  const kinds = await import("../../server/plugins/_core/kinds");
  return {
    ...kinds,
    enforceKindGating: async (metadata: any) => {
      if (metadata.requiredComponent && !state.components.has(metadata.requiredComponent)) {
        return { ok: false, status: 403, message: "Component disabled" };
      }
      if (metadata.requiredPolicy && !state.policies.has(metadata.requiredPolicy)) {
        return { ok: false, status: 403, message: "Access denied" };
      }
      return { ok: true };
    },
  };
});
vi.mock("../../server/plugins/_core/gating", () => ({
  isPluginComponentEnabledAsync: async (metadata: any) =>
    !metadata.requiredComponent || state.components.has(metadata.requiredComponent),
  isPluginVisibleToUser: async (metadata: any) => ({
    ok: !metadata.requiredPolicy || state.policies.has(metadata.requiredPolicy),
  }),
}));
vi.mock("../../server/plugins/_core/config-adapter", () => ({
  getPluginConfigAdapter: (kind: string) => kind === "flood" ? {} : undefined,
}));

const { PluginRegistry } = await import("../../server/plugins/_core/registry");
const { registerPluginKind } = await import("../../server/plugins/_core/kinds");
const { registerPluginsManifestRoutes } = await import("../../server/modules/system/plugins-manifest");
const { floodPluginRegistry } = await import("../../server/plugins/system/flood/registry");
const { pluginDefinitionEntry } = await import("../../server/plugins/_core/definition-catalog");

const callback = vi.fn();
const decorate = vi.fn(() => { throw new Error("Runtime decoration must not run"); });
let baseUrl: string;
let server: ReturnType<ReturnType<typeof express>["listen"]>;

beforeAll(async () => {
  floodPluginRegistry.register({
    id: "login", name: "Login attempts", description: "Limits failed logins.",
    singleton: true, defaults: { threshold: 5, windowSeconds: 60 },
    getIdentifier: callback,
  });
  registerPluginKind({
    kind: "flood", label: "Flood", registry: floodPluginRegistry, requiredPolicy: "kind-reader",
    requiredComponent: "kind-component", decorateEntries: decorate,
  });
  const registry = new PluginRegistry({
    kind: "test-definitions",
    getMetadata: (plugin: any) => plugin,
    toManifestEntry: (plugin: any) => ({
      id: plugin.id, declared: { enabledByDefault: true, callback },
    }),
  });
  for (const plugin of [
    { id: "open", name: "Open", description: "Available" },
    { id: "gated", name: "Gated", description: "Gated", requiredPolicy: "plugin-reader", requiredComponent: "plugin-component" },
    { id: "hidden", name: "Hidden", description: "Hidden", hidden: true },
  ]) registry.register(plugin);
  registerPluginKind({ kind: "test-definitions", registry });
  const app = express();
  registerPluginsManifestRoutes(app, (_req, res, next) => {
    if (!state.authenticated) res.status(401).json({ message: "Sign in" });
    else next();
  });
  server = app.listen(0);
  await new Promise<void>((resolve) => server.on("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
beforeEach(() => {
  state.authenticated = true;
  state.policies = new Set(["admin", "kind-reader", "plugin-reader"]);
  state.components = new Set(["kind-component", "plugin-component"]);
});
const get = (kind: string) => fetch(`${baseUrl}/api/plugins/${kind}/catalog`);

describe("plugin definition catalogs", () => {
  it("projects flood defaults and schemas, not runtime decoration or callbacks", async () => {
    const response = await get("flood");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Cookie");
    const { catalog } = await response.json();
    expect(catalog.configurationPath).toBe("/admin/plugin-configs/flood");
    expect(catalog.entries[0]).toMatchObject({
      id: "login", name: "Login attempts", description: "Limits failed logins.",
      detail: { defaults: { threshold: 5, windowSeconds: 60 }, singleton: true,
        configSchema: { properties: { threshold: { default: 5 } } } },
    });
    expect(JSON.stringify(catalog)).not.toContain("getIdentifier");
    expect(callback).not.toHaveBeenCalled();
    expect(decorate).not.toHaveBeenCalled();
  });

  it("enforces authentication, admin, kind policy and component gates", async () => {
    state.authenticated = false;
    expect((await get("flood")).status).toBe(401);
    state.authenticated = true;
    state.policies.delete("admin");
    expect((await get("flood")).status).toBe(403);
    state.policies.add("admin");
    state.policies.delete("kind-reader");
    expect((await get("flood")).status).toBe(403);
    state.policies.add("kind-reader");
    state.components.delete("kind-component");
    expect((await get("flood")).status).toBe(403);
    state.components.add("kind-component");
    expect((await get("flood")).status).toBe(200);
    expect((await get("unknown")).status).toBe(404);
  });

  it("rechecks plugin policies and components on every read, omitting hidden definitions", async () => {
    const ids = async () => {
      const { catalog } = await (await get("test-definitions")).json();
      expect(catalog.configurationPath).toBeUndefined();
      return catalog.entries.map((entry: any) => entry.id);
    };
    expect(await ids()).toEqual(["gated", "open"]);
    state.policies.delete("plugin-reader");
    expect(await ids()).toEqual(["open"]);
    state.policies.add("plugin-reader");
    state.components.delete("plugin-component");
    expect(await ids()).toEqual(["open"]);
    state.components.add("plugin-component");
    expect(await ids()).toEqual(["gated", "open"]);
  });

  it("removes nested executable attributes without invoking them", () => {
    const entry = pluginDefinitionEntry(
      { id: "example", name: "Example", description: "" },
      { id: "example", enabled: true, enabledByDefault: false,
        options: { callback, label: "Code default" }, toJSON: callback },
    );
    expect(entry.detail?.options).toEqual({ label: "Code default" });
    expect(entry.detail).not.toHaveProperty("toJSON");
    expect(entry.detail).not.toHaveProperty("enabled");
    expect(entry.detail?.enabledByDefault).toBe(false);
    expect(() => JSON.stringify(entry)).not.toThrow();
    expect(callback).not.toHaveBeenCalled();
  });
});
