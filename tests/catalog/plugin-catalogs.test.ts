import type { AddressInfo } from "node:net";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// These tests protect the registry -> ordinary catalog boundary, not a second
// plugin reader: all HTTP assertions exercise the existing catalog routes.
const state = vi.hoisted(() => ({
  authenticated: true,
  admin: true,
  components: new Set(["kind-component", "plugin-component"]),
  revision: 0,
}));
vi.mock("../../server/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn() } }));
vi.mock("../../server/services/component/cache", () => ({
  isComponentEnabledSync: (id: string) => state.components.has(id),
}));
vi.mock("../../server/services/access-policy-evaluator", () => ({
  buildContext: async () => ({ user: state.authenticated ? { id: "admin" } : null }),
}));
vi.mock("../../server/storage", () => ({
  storage: { users: { userHasPermission: async (_id: string, permission: string) =>
    state.admin && permission === "admin" } },
}));

const { registerCatalogRoutes } = await import("../../server/modules/catalogs");
const { PluginRegistry } = await import("../../server/plugins/_core/registry");
const { listPluginKindRegistrations, registerPluginKind } = await import("../../server/plugins/_core/kinds");
const { registerPluginCatalogs } = await import("../../server/plugins/_core/catalogs");
const { pluginDefinitionEntry } = await import("../../server/plugins/_core/definition-catalog");
const {
  registerCatalog, resetCatalogRegistry, setCatalogComponentSource, closeCatalogRegistration,
} = await import("@shared/catalog");

const callback = vi.fn(() => { throw new Error("Executable callback invoked"); });
const decorate = vi.fn(() => { throw new Error("Runtime decoration invoked"); });
const registry = new PluginRegistry({
  kind: "example",
  getMetadata: (plugin: any) => plugin,
  toManifestEntry: (plugin: any) => ({
    id: plugin.id, enabled: true, enabledByDefault: false,
    defaults: { count: 5, callback, toJSON: callback },
    configSchema: { type: "object", properties: { count: { default: 5 } } },
  }),
});
let baseUrl: string;
let server: ReturnType<ReturnType<typeof express>["listen"]>;
const get = async (path: string) => {
  const response = await fetch(`${baseUrl}/api/catalogs${path}`);
  return { status: response.status, headers: response.headers, body: await response.json() };
};

beforeAll(async () => {
  registry.register({ id: "open", name: "Open", description: "Code declaration" });
  registry.register({
    id: "gated", name: "Gated", description: "Policy is metadata only",
    requiredPolicy: "not-admin", requiredComponent: "plugin-component",
  });
  registry.register({ id: "hidden", name: "Hidden", description: "", hidden: true });
  registerPluginKind({
    kind: "example", label: "Example", description: "Example kind",
    registry, requiredComponent: "kind-component",
    requiredPolicy: "not-admin", decorateEntries: decorate,
  });
  // No config adapter needed, including for an empty registry.
  registerPluginKind({
    kind: "empty", registry: new PluginRegistry({
      kind: "empty", getMetadata: (p: any) => p, toManifestEntry: (p) => p,
    }),
  });
  setCatalogComponentSource({
    isEnabled: (id) => state.components.has(id),
    getRevision: () => state.revision,
  });
  const app = express();
  registerCatalogRoutes(app);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.on("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
beforeEach(() => {
  state.authenticated = state.admin = true;
  state.components = new Set(["kind-component", "plugin-component"]);
  state.revision++;
  resetCatalogRegistry();
  registerPluginCatalogs();
  closeCatalogRegistration();
});

describe("ordinary plugin catalogs", () => {
  it("discovers one independent catalog per kind, with standard summaries and response", async () => {
    const index = await get("");
    expect(index.body.catalogs.map((c: any) => c.id)).toEqual(
      listPluginKindRegistrations().map((kind) => `${kind.kind}-plugins`),
    );
    expect(index.body.catalogs[0]).toMatchObject({
      id: "example-plugins", label: "Example", audience: "gated",
      tier: "public", entryCount: 2,
    });
    const response = await get("/example-plugins");
    expect(response.status).toBe(200);
    expect(Object.keys(response.body.catalog).sort()).toEqual([
      "audience", "description", "entries", "id", "label", "tier",
    ]);
    expect(response.headers.get("cache-control")).toBe("private, no-cache");
    expect(response.headers.get("vary")).toContain("Cookie");
    expect(response.headers.get("x-catalog-version")).toBeTruthy();
    expect((await get("/empty-plugins")).body.catalog.entries).toEqual([]);
  });

  it("uses only normal admin catalog access, not plugin policies", async () => {
    state.authenticated = false;
    expect((await get("/example-plugins")).status).toBe(401);
    expect((await get("")).body.catalogs).toEqual([]);
    state.authenticated = true;
    state.admin = false;
    expect((await get("/example-plugins")).status).toBe(403);
    state.admin = true;
    const entries = (await get("/example-plugins")).body.catalog.entries;
    expect(entries.map((e: any) => e.id)).toEqual(["gated", "open"]);
    expect(entries[0].detail.requiredPolicy).toBe("not-admin");
  });

  it("rechecks both component levels and late plugin registrations on each read", async () => {
    const initial = await get("/example-plugins");
    state.components.delete("plugin-component");
    state.revision++;
    expect((await get("/example-plugins")).body.catalog.entries.map((e: any) => e.id)).toEqual(["open"]);
    state.components.delete("kind-component");
    state.revision++;
    expect((await get("/example-plugins")).body.catalog.entries).toEqual([]);
    expect((await get("")).body.catalogs[0].entryCount).toBe(0);
    registry.register({ id: "late", name: "Late", description: "" });
    state.components = new Set(["kind-component", "plugin-component"]);
    state.revision++;
    const restored = await get("/example-plugins");
    expect(restored.body.catalog.entries.map((e: any) => e.id)).toEqual(["gated", "late", "open"]);
    expect(restored.headers.get("x-catalog-version")).not.toBe(initial.headers.get("x-catalog-version"));
  });

  it("preserves declared defaults/schema without callbacks, enabled placeholders or decoration", async () => {
    const { body } = await get("/example-plugins");
    expect(body.catalog.entries[0].detail).toMatchObject({
      defaults: { count: 5 }, enabledByDefault: false,
      configSchema: { properties: { count: { default: 5 } } },
    });
    expect(JSON.stringify(body)).not.toMatch(/callback|toJSON|"enabled":|hidden/);
    const accessor = { get unsafe() { return callback(); }, safe: "declared" };
    expect(pluginDefinitionEntry(
      { id: "safe", name: "Safe", description: "" },
      { accessor, executableObject: new class { toJSON = callback; }() },
    ).detail?.accessor).toEqual({ safe: "declared" });
    expect(pluginDefinitionEntry(
      { id: "safe", name: "Safe", description: "" },
      { executableObject: new class { toJSON = callback; }() },
    ).detail).not.toHaveProperty("executableObject");
    expect(callback).not.toHaveBeenCalled();
    expect(decorate).not.toHaveBeenCalled();
  });

  it("rejects catalog ID collisions rather than silently dropping a kind", () => {
    resetCatalogRegistry();
    registerCatalog({ id: "example-plugins", label: "Collision", audience: "signed-in", entries: () => [] });
    expect(() => registerPluginCatalogs()).toThrow(/already registered/);
  });
});
