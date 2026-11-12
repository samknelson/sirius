import { beforeEach, describe, expect, it } from "vitest";
import { initializePermissions, permissionRegistry } from "../shared/permissions";
import { hasTabPermission, workerTabTree } from "../shared/tabRegistry";

describe("core permissions", () => {
  beforeEach(() => {
    permissionRegistry.clear();
  });

  it("registers metadata.view for role management", () => {
    initializePermissions();

    expect(permissionRegistry.getByKey("metadata.view")).toEqual({
      key: "metadata.view",
      description: "View record history metadata and provenance",
      module: "core",
    });
  });

  it("registers worker.delete and uses it for the worker Delete tab", () => {
    initializePermissions();

    expect(permissionRegistry.getByKey("worker.delete")).toEqual({
      key: "worker.delete",
      description: "Permanently delete workers",
      module: "core",
    });
    const deleteTab = workerTabTree.find((tab) => tab.id === "delete");
    expect(deleteTab?.permission).toBe("worker.delete");
    expect(deleteTab?.adminBypass).toBe(true);
    expect(hasTabPermission(deleteTab!, (key) => key === "worker.delete")).toBe(true);
    expect(hasTabPermission(deleteTab!, (key) => key === "admin")).toBe(true);
    expect(hasTabPermission(deleteTab!, (key) => key === "staff")).toBe(false);
  });
});