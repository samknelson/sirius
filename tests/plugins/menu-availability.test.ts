import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request } from "express";

const fixture = vi.hoisted(() => ({
  selected: "optional-layout",
  enabled: false,
  builds: vi.fn(),
  savedRead: vi.fn(),
}));

vi.mock("../../server/services/access-policy-evaluator", () => ({
  buildContext: async () => ({ user: { id: "viewer", email: null } }),
  checkAccessInline: async () => ({ granted: true }),
}));
vi.mock("../../server/modules/components", () => ({ isComponentEnabled: async () => false }));
vi.mock("../../server/storage", () => ({
  storage: { variables: { getByName: () => {
    fixture.savedRead();
    return { value: fixture.selected };
  } } },
}));
vi.mock("@shared/alter", () => ({
  alterHooks: { declare: (hook: unknown) => hook, run: async (_hook: unknown, tree: unknown) => tree },
}));
vi.mock("../../server/plugins/menu/registry", () => ({
  menuPluginRegistry: {
    isEnabledAsync: async (id: string) => id === "default" || (id === "optional-layout" && fixture.enabled),
    get: (id: string) => ["default", "optional-layout"].includes(id)
      ? { metadata: { id }, buildTree: () => {
        fixture.builds(id);
        return [{ id: "home", label: "Home", icon: "Home", href: "/" }];
      } }
      : undefined,
  },
}));

import { MenuPluginUnavailableError, resolveMenuForRequest } from "../../server/plugins/menu/resolve";

// Shared resolver invariant: registration alone must never make a disabled
// component's layout runnable. No feature-specific layout or UI assertions.
describe("menu plugin availability at resolution", () => {
  const req = {} as Request;
  beforeEach(() => {
    fixture.selected = "optional-layout";
    fixture.enabled = false;
    vi.clearAllMocks();
  });

  it.each(["optional-layout", "missing-layout"])("falls back without rewriting saved %s", async (selected) => {
    fixture.selected = selected;
    expect((await resolveMenuForRequest(req)).plugin).toBe("default");
    expect(fixture.selected).toBe(selected);
    expect(fixture.builds).toHaveBeenCalledExactlyOnceWith("default");
  });

  it.each(["optional-layout", "missing-layout"])("refuses an explicit unavailable %s", async (selected) => {
    await expect(resolveMenuForRequest(req, selected)).rejects.toBeInstanceOf(MenuPluginUnavailableError);
    expect(fixture.builds).not.toHaveBeenCalled();
    expect(fixture.savedRead).not.toHaveBeenCalled();
  });

  it("resolves an enabled saved selection and notices it becoming unavailable", async () => {
    fixture.enabled = true;
    expect((await resolveMenuForRequest(req)).plugin).toBe("optional-layout");
    fixture.enabled = false;
    expect((await resolveMenuForRequest(req)).plugin).toBe("default");
  });

  it("previews an enabled plugin without reading or changing the saved selection", async () => {
    fixture.enabled = true;
    fixture.selected = "default";
    expect((await resolveMenuForRequest(req, "optional-layout")).plugin).toBe("optional-layout");
    expect(fixture.savedRead).not.toHaveBeenCalled();
    expect(fixture.selected).toBe("default");
  });
});
