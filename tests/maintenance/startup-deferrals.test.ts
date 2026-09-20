import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../server/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { setMaintenanceActive } from "../../server/services/maintenance-flag";
import {
  getDeferredStartupOperationNames,
  resetStartupDeferralsForTest,
  runDeferredStartupOperations,
  runOrDeferStartupOperation,
} from "../../server/services/startup-deferrals";

describe("maintenance-aware startup reconciliation", () => {
  beforeEach(() => {
    resetStartupDeferralsForTest();
    setMaintenanceActive(false);
  });

  afterEach(() => {
    setMaintenanceActive(false);
    resetStartupDeferralsForTest();
  });

  it("runs immediately and preserves fatal failures outside maintenance", async () => {
    const failure = new Error("unexpected initialization failure");
    await expect(
      runOrDeferStartupOperation("broken", async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(getDeferredStartupOperationNames()).toEqual([]);
  });

  it("does not attempt mutations while maintenance is active", async () => {
    setMaintenanceActive(true);
    const operation = vi.fn(async () => {});

    await expect(
      runOrDeferStartupOperation("seed", operation),
    ).resolves.toBe("deferred");

    expect(operation).not.toHaveBeenCalled();
    expect(getDeferredStartupOperationNames()).toEqual(["seed"]);
  });

  it("completes deferred work after maintenance exits", async () => {
    setMaintenanceActive(true);
    const operation = vi.fn(async () => {});
    await runOrDeferStartupOperation("seed", operation);

    setMaintenanceActive(false);
    await runDeferredStartupOperations();

    expect(operation).toHaveBeenCalledOnce();
    expect(getDeferredStartupOperationNames()).toEqual([]);
  });

  it("reports and retains a failed deferred operation for retry", async () => {
    setMaintenanceActive(true);
    const operation = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("still unavailable"))
      .mockResolvedValueOnce();
    await runOrDeferStartupOperation("seed", operation);

    setMaintenanceActive(false);
    await runDeferredStartupOperations();
    expect(getDeferredStartupOperationNames()).toEqual(["seed"]);

    await runDeferredStartupOperations();
    expect(operation).toHaveBeenCalledTimes(2);
    expect(getDeferredStartupOperationNames()).toEqual([]);
  });

  it("pauses remaining work if maintenance is re-entered during a drain", async () => {
    setMaintenanceActive(true);
    const first = vi.fn(async () => {
      setMaintenanceActive(true);
    });
    const second = vi.fn(async () => {});
    await runOrDeferStartupOperation("first", first);
    await runOrDeferStartupOperation("second", second);

    setMaintenanceActive(false);
    await runDeferredStartupOperations();

    expect(first).toHaveBeenCalledOnce();
    expect(second).not.toHaveBeenCalled();
    expect(getDeferredStartupOperationNames()).toEqual(["second"]);
  });
});