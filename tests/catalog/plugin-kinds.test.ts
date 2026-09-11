import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ANONYMOUS_VIEWER,
  clearCatalogComponentSource,
  readCatalog,
  resetCatalogRegistry,
  setCatalogComponentSource,
  type CatalogViewer,
} from "@shared/catalog";
import { PLUGIN_KINDS_CATALOG } from "@shared/catalog-ids";

const state = vi.hoisted(() => ({
  registrations: [] as Array<{
    kind: string;
    label?: string;
    description?: string;
    requiredComponent?: string;
  }>,
  configurable: new Set<string>(),
}));

vi.mock("../../server/plugins/_core/kinds", () => ({
  listPluginKindRegistrations: () => state.registrations,
  getPluginKind: (kind: string) =>
    state.registrations.find((registration) => registration.kind === kind),
}));

vi.mock("../../server/plugins/_core/config-adapter", () => ({
  getPluginConfigAdapter: (kind: string) =>
    state.configurable.has(kind) ? { pluginKind: kind } : undefined,
  listPluginConfigAdapters: () => Array.from(state.configurable),
}));

import { registerPluginKindsCatalog } from "../../server/plugins/_core/kinds-catalog";

const admin: CatalogViewer = {
  authenticated: true,
  hasPermission: (permission) => permission === "admin",
};

const nonAdmin: CatalogViewer = {
  authenticated: true,
  hasPermission: () => false,
};

function wireComponents(enabled: Record<string, boolean>): void {
  clearCatalogComponentSource();
  setCatalogComponentSource({
    isEnabled: (component) => enabled[component] ?? false,
    getRevision: () => 1,
  });
}

beforeEach(() => {
  resetCatalogRegistry();
  state.registrations.length = 0;
  state.configurable.clear();
  wireComponents({});
  registerPluginKindsCatalog();
});

describe("Plugin Kinds catalog", () => {
  it("projects every runtime kind and identifies configurable kinds", () => {
    state.registrations.push(
      {
        kind: "manifest-only",
        label: "Manifest Only",
        description: "Has no stored configuration.",
      },
      {
        kind: "stored-settings",
        label: "Stored Settings",
      },
    );
    state.configurable.add("stored-settings");

    const result = readCatalog(PLUGIN_KINDS_CATALOG, admin);
    if (!result.ok) throw new Error(result.message);

    expect(result.catalog.label).toBe("Plugin Kinds");
    expect(result.catalog.entries).toEqual([
      {
        id: "manifest-only",
        name: "Manifest Only",
        description: "Has no stored configuration.",
        detail: { configurable: false },
      },
      {
        id: "stored-settings",
        name: "Stored Settings",
        detail: { configurable: true },
      },
    ]);
  });

  it("derives late registrations and component availability on every read", () => {
    state.registrations.push({
      kind: "component-kind",
      requiredComponent: "feature.example",
    });
    state.configurable.add("component-kind");

    wireComponents({ "feature.example": false });
    let result = readCatalog(PLUGIN_KINDS_CATALOG, admin);
    if (!result.ok) throw new Error(result.message);
    expect(result.catalog.entries).toEqual([]);

    wireComponents({ "feature.example": true });
    result = readCatalog(PLUGIN_KINDS_CATALOG, admin);
    if (!result.ok) throw new Error(result.message);
    expect(result.catalog.entries).toMatchObject([
      {
        id: "component-kind",
        name: "Component Kind",
        component: "feature.example",
        detail: { configurable: true },
      },
    ]);

    state.registrations.push({ kind: "registered-later", label: "Registered Later" });
    result = readCatalog(PLUGIN_KINDS_CATALOG, admin);
    if (!result.ok) throw new Error(result.message);
    expect(result.catalog.entries.map((entry) => entry.id)).toContain("registered-later");
  });

  it("is readable only by administrators", () => {
    expect(readCatalog(PLUGIN_KINDS_CATALOG, admin)).toMatchObject({ ok: true });
    expect(readCatalog(PLUGIN_KINDS_CATALOG, nonAdmin)).toMatchObject({
      ok: false,
      reason: "denied",
    });
    expect(readCatalog(PLUGIN_KINDS_CATALOG, ANONYMOUS_VIEWER)).toMatchObject({
      ok: false,
      reason: "denied",
    });
  });

  it("refuses an adapter with no executable kind registration", () => {
    resetCatalogRegistry();
    state.configurable.add("orphan-adapter");

    expect(() => registerPluginKindsCatalog()).toThrow(
      "Plugin config adapter 'orphan-adapter' has no plugin-kind registration.",
    );
  });

  it("generates Config links only for configurable catalog entries", async () => {
    const { configSections, resolveConfigSections } = await import(
      "../../client/src/config/navigation-registry"
    );
    const pluginSection = configSections.find((section) => section.id === "plugins");
    if (!pluginSection) throw new Error("expected Plugins config section");

    const resolved = resolveConfigSections(
      {
        options: { entries: [], status: "ready" },
        pluginKinds: {
          entries: [
            {
              kind: "configurable",
              label: "Configurable",
              configurable: true,
              requiredComponent: "feature.example",
            },
            {
              kind: "manifest-only",
              label: "Manifest Only",
              configurable: false,
            },
          ],
          status: "ready",
        },
      },
      [pluginSection],
    )[0];

    expect(resolved.itemsStatus).toBe("ready");
    expect(resolved.items.map((item) => item.path)).toEqual([
      "/admin/plugin-configs",
      "/admin/plugin-configs/configurable",
    ]);
    expect(resolved.items[1]).toMatchObject({
      label: "Configurable",
      requiresComponent: "feature.example",
      permission: "admin",
    });
  });
});