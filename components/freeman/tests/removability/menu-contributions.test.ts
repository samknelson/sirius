import { expect, it, vi } from "vitest";
import type { MenuPlugin } from "../../../../server/plugins/menu/types";
const registered = vi.hoisted(() => new Map<string, MenuPlugin>());
vi.mock("../../../../server/plugins/menu/registry", () => ({
  registerMenuPlugin: (plugin: MenuPlugin) => registered.set(plugin.metadata.id, plugin),
}));
import "../../../../server/plugins/menu/plugins/default";
import "../../../../server/plugins/menu/plugins/edls";

it("preserves Crew Leads and its gates in both default and promoted EDLS navigation", () => {
  const defaults = registered.get("default")!.buildTree();
  const children = defaults.find(n => n.id === "edls")!.children!;
  const original = children.find(n => n.id === "edls-freeman-crewleads")!;
  expect(original.href).toBe("/edls/freeman/crewleads");
  expect(original.gate).toEqual({allOf: [{component: "sitespecific.freeman"}, {policy: "edls.any"}]});

  const promoted = registered.get("edls")!.buildTree().find(n => n.id === original.id)!;
  expect(promoted.href).toBe(original.href);
  expect(promoted.testId).toBe(`nav-${original.id}`);
  expect(promoted.gate).toEqual({allOf: [{component: "edls"}, original.gate]});
  expect(registered.get("edls")!.buildTree().filter(n => n.id === original.id)).toHaveLength(1);
});
