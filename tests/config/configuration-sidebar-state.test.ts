import { describe, expect, it } from "vitest";
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

    const collapsed = toggleConfigurationSection(initial, "system");
    expect(collapsed.openSections.system).toBe(false);

    expect(
      reconcileConfigurationSectionNavigation(collapsed, "/config/a", ["system", "nested"]),
    ).toBe(collapsed);
  });

  it("opens ancestors for a new path without resetting other user choices", () => {
    let state = createConfigurationSectionOpenState("/config/a", ["system"]);
    state = toggleConfigurationSection(state, "system");
    state = toggleConfigurationSection(state, "theme");

    const navigated = reconcileConfigurationSectionNavigation(
      state,
      "/config/workers/settings",
      ["workers", "worker-details"],
    );

    expect(navigated.openSections).toEqual({
      system: false,
      theme: true,
      workers: true,
      "worker-details": true,
    });
  });

  it("opens an active ancestor that arrives after dynamic navigation resolves", () => {
    const loading = createConfigurationSectionOpenState("/config/options/gender/list", []);
    const ready = reconcileConfigurationSectionNavigation(
      loading,
      "/config/options/gender/list",
      ["dropdown-lists"],
    );
    expect(ready.openSections["dropdown-lists"]).toBe(true);
  });
});

describe("configuration whole-menu preference", () => {
  it("defaults open and restores a saved closed preference", () => {
    expect(loadConfigurationMenuOpen({ getItem: () => null })).toBe(true);
    expect(loadConfigurationMenuOpen({ getItem: () => "false" })).toBe(false);
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
    })).toBe(true);

    expect(() => saveConfigurationMenuOpen(true, {
      setItem: () => {
        throw new Error("blocked");
      },
    })).not.toThrow();
  });
});