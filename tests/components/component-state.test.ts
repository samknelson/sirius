import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentDefinition } from "../../shared/components";

const mocks = vi.hoisted(() => ({ read: vi.fn(), outside: vi.fn((fn: () => unknown) => fn()) }));
vi.mock("../../server/storage", () => ({ storage: { variables: { getJsonState: mocks.read } } }));
vi.mock("../../server/storage/transaction-context", () => ({ runOutsideTransaction: mocks.outside }));
vi.mock("../../server/storage/configuration-revisions", () => ({ readConfigurationSnapshot: mocks.outside }));
vi.mock("../../server/services/component-cache", () => ({
  loadComponentCache: () => { throw new Error("Broken runtime cache"); },
  isComponentEnabledSync: () => { throw new Error("Uninitialized runtime cache"); },
}));
import { getAllComponents } from "../../shared/components";
import { getComponentConfigsFromStorage, readComponentStateFromStorage, resolveComponentEnabled } from "../../server/services/component-state";

beforeEach(() => { vi.clearAllMocks(); mocks.read.mockResolvedValue(undefined); });
afterEach(() => { vi.useRealTimers(); });

describe("direct component storage snapshots", () => {
  it("reads outside the ambient transaction and freezes an independent snapshot", async () => {
    const stored = { facility: false, "future.retained": true };
    mocks.read.mockResolvedValue({ value: stored, version: "42" });
    const snapshot = await readComponentStateFromStorage();
    expect(mocks.read).toHaveBeenCalledWith("components");
    expect(mocks.outside).toHaveBeenCalledOnce();
    stored.facility = true;
    expect(snapshot.state).toEqual({ facility: false, "future.retained": true });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.state)).toBe(true);
    expect(snapshot.version).toBe("42");
  });

  it("uses defaults only for absent flags and honors explicit false and true", () => {
    const component = { id: "test", enabledByDefault: true } as ComponentDefinition;
    expect(resolveComponentEnabled(component, {})).toBe(true);
    expect(resolveComponentEnabled(component, { test: false })).toBe(false);
    expect(resolveComponentEnabled({ ...component, enabledByDefault: false }, { test: true })).toBe(true);
    expect(resolveComponentEnabled({ ...component, id: "constructor", enabledByDefault: false }, {})).toBe(false);
  });

  it("returns server definitions and one stored snapshot despite broken runtime cache functions", async () => {
    mocks.read.mockResolvedValue({ value: { facility: true, "future.retained": false }, version: "42" });
    const configs = await getComponentConfigsFromStorage();
    expect(mocks.read).toHaveBeenCalledOnce();
    expect(configs.map(c => c.definition)).toEqual(getAllComponents());
    expect(configs.find(c => c.componentId === "facility")?.enabled).toBe(true);
    for (const config of configs) {
      if (config.componentId !== "facility") expect(config.enabled).toBe(config.definition?.enabledByDefault);
    }
    expect(configs.some(c => c.componentId === "future.retained")).toBe(false);
  });

  it("does not substitute defaults after storage fails", async () => {
    mocks.read.mockRejectedValue(new Error("Storage unavailable"));
    await expect(getComponentConfigsFromStorage()).rejects.toThrow("Storage unavailable");
  });

  it.each([null, undefined, [], "invalid", { facility: "true" }])("refuses a malformed present row: %j", async value => {
    mocks.read.mockResolvedValue({ value, version: "42" });
    await expect(getComponentConfigsFromStorage()).rejects.toThrow("boolean flags");
  });

  it("bounds stalled reads to five seconds", async () => {
    vi.useFakeTimers();
    mocks.read.mockReturnValue(new Promise(() => {}));
    const result = expect(readComponentStateFromStorage()).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(5_000);
    await result;
  });
});
