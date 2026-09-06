import { beforeEach, describe, expect, it } from "vitest";
import { initializePermissions, permissionRegistry } from "../shared/permissions";

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
});