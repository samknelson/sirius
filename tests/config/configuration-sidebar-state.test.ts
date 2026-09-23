import { describe, expect, it, vi } from "vitest";
import {
  CONFIGURATION_MENU_STORAGE_KEY,
  createConfigurationSectionOpenState,
  loadConfigurationMenuOpen,
  reconcileConfigurationSectionNavigation,
  saveConfigurationMenuOpen,
  toggleConfigurationSection,
} from "../../client/src/components/layouts/configuration-sidebar-state";

describe("configuration sidebar section state", () => {
  it("opens active ancestors initially and still lets the user collapse them", () => {
    const initial = createConfigurationSectionOpenState("/config/a", ["system", "nested"]);
    expect(initial.openSections).toEqual({ system: true, nested: true });

    const collapsed = toggleConfigurationSection(initial, "system", ["system", "theme"]);
    expect(collapsed.openSections.system).toBe(false);

    expect(
      reconcileConfigurationSectionNavigation(collapsed, "/config/a", ["system", "nested"], ["system", "theme"]),
    ).toBe(collapsed);
  });

  it("opens only one top-level section while preserving nested choices", () => {
    let state = createConfigurationSectionOpenState("/config/a", ["system"]);
    state = toggleConfigurationSection(state, "nested", ["system", "theme", "workers"]);
    state = toggleConfigurationSection(state, "theme", ["system", "theme", "workers"]);
    expect(state.openSections).toEqual({ system: false, nested: true, theme: true, workers: false });
    state = toggleConfigurationSection(state, "system", ["system", "theme", "workers"]);
    expect(state.openSections).toEqual({ system: true, nested: true, theme: false, workers: false });

    const navigated = reconcileConfigurationSectionNavigation(
      state,
      "/config/workers/settings",
      ["workers", "worker-details"],
      ["system", "theme", "workers"],
    );

    expect(navigated.openSections).toEqual({
      system: false,
      theme: false,
      nested: true,
      workers: true,
      "worker-details": true,
    });
  });

  it("lets the open section close without opening a replacement", () => {
    const initial = createConfigurationSectionOpenState("/config/ledger", ["ledger"]);
    const closed = toggleConfigurationSection(initial, "ledger", ["ledger", "dropdown-lists"]);
    expect(closed.openSections.ledger).toBe(false);
    expect(closed.openSections["dropdown-lists"]).toBeUndefined();
  });

  it("opens an active ancestor that arrives after dynamic navigation resolves", () => {
    const loading = createConfigurationSectionOpenState("/config/options/gender/list", []);
    const ready = reconcileConfigurationSectionNavigation(
      loading,
      "/config/options/gender/list",
      ["dropdown-lists"],
      ["system", "dropdown-lists"],
    );
    expect(ready.openSections["dropdown-lists"]).toBe(true);
  });
});

describe("configuration whole-menu preference", () => {
  it("keeps navigation available when accessing localStorage itself throws", () => {
    vi.stubGlobal("window", {
      get localStorage() {
        throw new Error("Storage access denied");
      },
    });
    try {
      expect(loadConfigurationMenuOpen()).toBe(false);
      expect(() => saveConfigurationMenuOpen(false)).not.toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("defaults collapsed and restores both saved preferences", () => {
    expect(loadConfigurationMenuOpen({ getItem: () => null })).toBe(false);
    expect(loadConfigurationMenuOpen({ getItem: () => "true" })).toBe(true);
    expect(loadConfigurationMenuOpen({ getItem: () => "false" })).toBe(false);
    expect(loadConfigurationMenuOpen({ getItem: () => "unrecognized" })).toBe(false);
  });

  it("writes the preference under a stable key", () => {
    const values = new Map<string, string>();
    saveConfigurationMenuOpen(false, {
      setItem: (key, value) => values.set(key, value),
    });
    expect(values.get(CONFIGURATION_MENU_STORAGE_KEY)).toBe("false");
  });

  it("keeps navigation available when browser storage is blocked", () => {
    expect(loadConfigurationMenuOpen({
      getItem: () => {
        throw new Error("blocked");
      },
    })).toBe(false);

    expect(() => saveConfigurationMenuOpen(true, {
      setItem: () => {
        throw new Error("blocked");
      },
    })).not.toThrow();
  });
});