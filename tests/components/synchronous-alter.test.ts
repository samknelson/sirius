import { describe, expect, it } from "vitest";
import { createAlterRegistry, AlterExecutionError } from "@shared/alter";

describe("synchronous alter boundaries", () => {
  it("preserves ordering, identity, disabled exclusion and registration closure", () => {
    const registry = createAlterRegistry();
    const hook = registry.declareSync<string[], {}>({ id: "host.sync", description: "Sync host", semantics: "Compose" });
    let enabled = false;
    for (const id of ["b", "a"]) registry.registerSync(hook, {
      id, description: id, component: "owner", priority: 1, metadata: {},
      alter: value => [...value, id],
    });
    registry.close({ isKnown: () => true, isEnabled: () => enabled, isEnabledSync: () => enabled });
    const original: string[] = [];
    expect(registry.runSync(hook, original, {})).toBe(original);
    enabled = true;
    expect(registry.runSync(hook, original, {})).toEqual(["a", "b"]);
    expect(registry.implementations(hook).map(cb => cb.id)).toEqual(["a", "b"]);
    expect(() => registry.registerSync(hook, { id: "c", description: "c", component: "owner", priority: 0, metadata: {}, alter: v => v })).toThrow("closed");
  });
  it("requires synchronous availability and refuses unknown owners", () => {
    const registry = createAlterRegistry();
    const hook = registry.declareSync<null, {}>({ id: "host.sync", description: "Sync host", semantics: "Observe" });
    registry.registerSync(hook, { id: "callback", description: "Observe", component: "owner", priority: 0, metadata: {}, alter: v => v });
    expect(() => registry.runSync(hook, null, {})).toThrow("not closed");
    expect(() => registry.close({ isKnown: () => false, isEnabled: () => true, isEnabledSync: () => true })).toThrow("Unknown alter component");
    expect(() => registry.close({ isKnown: () => true, isEnabled: () => true })).toThrow("Synchronous");
  });
  it("rejects promises with safe errors through both execution entrypoints", async () => {
    const registry = createAlterRegistry();
    const hook = registry.declareSync<null, {}>({ id: "host.sync", description: "Sync host", semantics: "Observe" });
    registry.registerSync(hook, {
      id: "callback", description: "Invalid runtime callback", component: "owner", priority: 0, metadata: {},
      // Deliberately bypass the static contract to model untyped code.
      alter: (() => Promise.reject(new Error("private-canary"))) as any,
    });
    registry.close({ isKnown: () => true, isEnabled: () => true, isEnabledSync: () => true });
    expect(() => registry.runSync(hook, null, {})).toThrow(AlterExecutionError);
    await expect(registry.run(hook, null, {})).rejects.toThrow("callback");
    await new Promise(resolve => setImmediate(resolve));
  });
  it("has no executable effect when no implementation is installed", () => {
    const registry = createAlterRegistry();
    const hook = registry.declareSync<null, {}>({ id: "host.sync", description: "Sync host", semantics: "Observe" });
    registry.close({ isKnown: () => false, isEnabled: () => false, isEnabledSync: () => false });
    expect(registry.runSync(hook, null, {})).toBeNull();
    expect(registry.implementations(hook)).toEqual([]);
  });
  it("refuses asynchronous availability without leaking its rejection", async () => {
    const registry = createAlterRegistry();
    const hook = registry.declareSync<null, {}>({ id: "host.sync", description: "Sync host", semantics: "Observe" });
    registry.registerSync(hook, { id: "callback", description: "Observe", component: "owner", priority: 0, metadata: {}, alter: value => value });
    registry.close({
      isKnown: () => true, isEnabled: () => true,
      isEnabledSync: (() => Promise.reject(new Error("private-availability-canary"))) as any,
    });
    expect(() => registry.runSync(hook, null, {})).toThrow(AlterExecutionError);
    await new Promise(resolve => setImmediate(resolve));
  });
});
