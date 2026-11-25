import { expect, it, vi } from "vitest";
const enabled = new Set(["owner"]);
vi.mock("../../server/services/component/cache", () => ({ isComponentEnabledSync: (id: string) => enabled.has(id) }));
vi.mock("../../server/modules/components", () => ({ isComponentEnabled: async (id: string) => enabled.has(id) }));
vi.mock("../../server/services/access-policy-evaluator", () => ({ checkAccessInline: vi.fn() }));
import { isPluginComponentEnabledSync, isPluginComponentEnabledAsync, enforcePluginGating } from "../../server/plugins/_core/gating";

it("requires every component before exposing a cross-component contribution", async () => {
  const meta = {id: "extension", name: "", description: "", requiredComponent: "owner", requiredComponents: ["host-feature"]};
  expect(isPluginComponentEnabledSync(meta)).toBe(false);
  expect(await isPluginComponentEnabledAsync(meta)).toBe(false);
  expect(await enforcePluginGating(meta, {} as any)).toMatchObject({ok: false, status: 403});
  enabled.add("host-feature");
  expect(isPluginComponentEnabledSync(meta)).toBe(true);
  expect(await isPluginComponentEnabledAsync(meta)).toBe(true);
  expect(await enforcePluginGating(meta, {} as any)).toEqual({ok: true});
  expect(isPluginComponentEnabledSync({id: "core", name: "", description: ""})).toBe(true);
});
