import { lazy } from "react";
import { describe, expect, it, vi } from "vitest";
import { createPluginComponentRegistry } from "../../client/src/plugins/_core/registry";

describe("component-owned browser implementations", () => {
  it("preserves original lookup keys without eagerly executing owned modules", () => {
    const load = vi.fn(async () => ({ default: () => null }));
    const Content = lazy(load);
    const registry = createPluginComponentRegistry({
      kind: "dashboard", glob: {}, contributions: [{ "summary:Content": Content }],
    });
    expect(registry.has("summary:Content")).toBe(true);
    expect(registry.resolve("summary:Content")).toBe(Content);
    expect(load).not.toHaveBeenCalled();
    expect(registry.has("wrong:Content")).toBe(false);
  });
  it("rejects duplicates between core and component contributions", () => {
    expect(() => createPluginComponentRegistry({
      kind: "dashboard", glob: { "./summary/Content.tsx": { Content: () => null } },
      contributions: [{ "summary:Content": () => null }],
    })).toThrow("Duplicate plugin component");
  });
  it("preserves core named and default exports", () => {
    const Content = () => null;
    const registry = createPluginComponentRegistry({
      kind: "dashboard",
      glob: { "./summary/Content.tsx": { Content }, "./summary/Other.tsx": { default: Content } },
    });
    expect(registry.resolve("summary:Content")).toBe(Content);
    expect(registry.resolve("summary:Other")).toBe(Content);
  });
  it("rejects collisions between independently installed owners", () => {
    expect(() => createPluginComponentRegistry({
      kind: "wizards", glob: {},
      contributions: [{ "summary:Content": () => null }, { "summary:Content": () => null }],
    })).toThrow("Duplicate plugin component");
  });
});
