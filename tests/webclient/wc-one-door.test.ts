import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * One door, whoever is behind it.
 *
 * Every outbound request — a transport this codebase wrote, or an operation a
 * vendor plugin declares — starts with the same `wcRequest` call and comes back
 * in the same shape. The suites next to this one pin what a particular vendor
 * does; this one pins what the door itself does regardless of vendor: it counts
 * a call once, it refuses an operation the vendor does not declare, it keeps
 * connections apart, and it hands a provider's own failure back instead of
 * throwing it at the caller.
 *
 * A test vendor rather than a real one on purpose. Asserting "exactly one
 * count" against Stripe or T631 would be asserting it against whatever those
 * plugins happen to do today; the property belongs to the framework, and the
 * plugin here exists only to be the far end of it.
 */

const recordCall = vi.hoisted(() => vi.fn());
const canStore = vi.hoisted(() => vi.fn());
const getConfig = vi.hoisted(() => vi.fn());
const getByKindAndPlugin = vi.hoisted(() => vi.fn());

vi.mock("../../server/storage", () => ({
  storage: {
    pluginConfigs: {
      get: (id: string) => getConfig(id),
      getByKindAndPlugin: (...args: unknown[]) => getByKindAndPlugin(...args),
    },
  },
}));

vi.mock("../../server/storage/wc-stats", () => ({
  wcStatsStorage: { recordCall: (...args: unknown[]) => recordCall(...args) },
}));

vi.mock("../../server/storage/wc-cache", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../server/storage/wc-cache")>();
  return { ...actual, wcCacheStorage: { ...actual.wcCacheStorage, canStore } };
});

import { registerWcVendorPlugin } from "../../server/plugins/wc-vendors/registry";
import { getWcRequest } from "../../server/services/webclient/registry";
import { wcRequest } from "../../server/services/webclient";

/** The test vendor's far end: whatever the current test wants it to do. */
const farEnd = vi.fn();

const TEST_PLUGIN_ID = "one-door-test";
const OPERATION = "one-door-answer";

registerWcVendorPlugin({
  id: TEST_PLUGIN_ID,
  name: "One Door Test Vendor",
  // A named service is what makes this a vendor the framework counts and can
  // refuse; without one it would take the in-process path instead.
  service: "Census",
  credential: { secretName: "none" },
  operations: {
    [OPERATION]: {
      description: "answer the one-door test",
      needsWritableDatabase: false,
      run: (_ctx: unknown, args: unknown) => farEnd(args),
    },
  },
} as never);

function connection(id: string) {
  return {
    id,
    pluginKind: "wc-vendors",
    pluginId: TEST_PLUGIN_ID,
    enabled: true,
    name: `Connection ${id}`,
    data: {},
  };
}

/** The request as a caller writes it, for an operation declared only in this file. */
const ask = (configId: string, args: unknown = { q: 1 }) =>
  wcRequest({
    vendor: { configId },
    operation: OPERATION,
    args,
  } as never);

beforeEach(() => {
  recordCall.mockReset();
  recordCall.mockResolvedValue(undefined);
  canStore.mockReset();
  canStore.mockResolvedValue(true);
  farEnd.mockReset();
  farEnd.mockResolvedValue({ answered: "yes" });
  getConfig.mockReset();
  getConfig.mockImplementation(async (id: string) =>
    id.startsWith("cfg-") ? connection(id) : undefined,
  );
  getByKindAndPlugin.mockReset().mockResolvedValue([]);
});

describe("the one entry point, for a vendor operation", () => {
  it("makes the call once and counts it once", async () => {
    const result = await ask("cfg-a");

    expect(result).toMatchObject({
      source: "network",
      outcome: "success",
      fresh: true,
      value: { answered: "yes" },
    });
    expect(farEnd).toHaveBeenCalledTimes(1);
    // One request, one count. Counting in both halves of the framework would
    // double every figure on the usage page, and it would do so silently.
    expect(recordCall).toHaveBeenCalledTimes(1);
    expect(recordCall).toHaveBeenCalledWith(
      "Census",
      OPERATION,
      expect.any(String),
      "cfg-a",
    );
  });

  it("attributes a default-resolved request to the configuration it resolved", async () => {
    getByKindAndPlugin.mockResolvedValue([connection("cfg-default")]);

    await wcRequest({
      vendor: { pluginId: TEST_PLUGIN_ID },
      operation: OPERATION,
      args: { q: 1 },
    } as never);

    expect(getByKindAndPlugin).toHaveBeenCalledWith("wc-vendors", TEST_PLUGIN_ID);
    expect(recordCall).toHaveBeenCalledWith(
      "Census",
      OPERATION,
      expect.any(String),
      "cfg-default",
    );
  });

  it("hands back the provider's failure, with the provider's own error on it", async () => {
    const thrown = Object.assign(new Error("the far end fell over"), {
      code: "provider_specific",
    });
    farEnd.mockRejectedValue(thrown);

    const result = await ask("cfg-a");

    // A failure at the far end is an answer about the far end, so it arrives
    // in the result rather than as a throw — and the provider's own object
    // survives, which is what lets a caller tell one provider error from
    // another instead of pattern-matching on a message.
    expect(result).toMatchObject({ outcome: "failure", fresh: false });
    expect(result.error).toContain("the far end fell over");
    expect(result.cause).toBe(thrown);
    // It happened, so it is counted like any other call.
    expect(recordCall).toHaveBeenCalledTimes(1);
  });

  it("refuses an operation the addressed vendor does not declare", async () => {
    // A valid operation name, declared by another vendor. The refusal is about
    // this connection not being able to do it, so it is not a vendor failure
    // and does not come back as a result.
    const error = await wcRequest({
      vendor: { configId: "cfg-a" },
      operation: "sirius_service_ping",
      args: undefined,
    }).then(
      () => undefined,
      (e: any) => e,
    );

    expect(error?.status).toBe(501);
    expect(error?.message).toContain("does not support");
    expect(farEnd).not.toHaveBeenCalled();
    expect(recordCall).not.toHaveBeenCalled();
  });

  it("keeps two connections to one vendor apart", async () => {
    const behavior = getWcRequest("Census", OPERATION);
    if (!behavior) throw new Error("the test vendor's operation was not registered");

    // Nothing is stored for a vendor operation today, so this identity is not
    // yet load-bearing — which is exactly why it is pinned here. The day one of
    // them caches, two connections sharing a key would read each other's
    // answers, and that failure looks like a vendor bug.
    const a = behavior.requestKey({ configId: "cfg-a", args: { q: 1 } });
    const b = behavior.requestKey({ configId: "cfg-b", args: { q: 1 } });
    expect(a).not.toBe(b);

    // The same request written with its arguments in a different order is the
    // same request.
    expect(behavior.requestKey({ configId: "cfg-a", args: { x: 1, y: 2 } })).toBe(
      behavior.requestKey({ configId: "cfg-a", args: { y: 2, x: 1 } }),
    );
  });

  it("asks nothing, and refuses nothing, on a mode that reads no network", async () => {
    const { setMaintenanceActive } = await import("../../server/services/maintenance-flag");
    setMaintenanceActive(true);
    try {
      // `local` and `cached-only` are answers about what we already hold. The
      // core reads no network on either, so neither may run the handler — and
      // neither may be refused for maintenance, which would report a closed
      // site to a caller that never asked to leave the building.
      for (const mode of ["local", "cached-only"] as const) {
        const result = await wcRequest({
          vendor: { configId: "cfg-a" },
          operation: OPERATION,
          args: { q: 1 },
          mode,
        } as never);
        expect(result).toMatchObject({ source: "none", fresh: false });
      }
    } finally {
      setMaintenanceActive(false);
    }

    expect(farEnd).not.toHaveBeenCalled();
    expect(recordCall).not.toHaveBeenCalled();
  });

  it("refuses during maintenance, once the request would actually be made", async () => {
    const { setMaintenanceActive } = await import("../../server/services/maintenance-flag");
    setMaintenanceActive(true);
    try {
      const error = await ask("cfg-a").then(
        () => undefined,
        (e: any) => e,
      );
      expect(error?.status).toBe(503);
    } finally {
      setMaintenanceActive(false);
    }

    expect(farEnd).not.toHaveBeenCalled();
    expect(recordCall).not.toHaveBeenCalled();
  });

  it("will not address a connection that does not exist", async () => {
    const error = await ask("missing").then(
      () => undefined,
      (e: any) => e,
    );

    expect(error?.status).toBe(404);
    expect(farEnd).not.toHaveBeenCalled();
    expect(recordCall).not.toHaveBeenCalled();
  });
});

describe("the contract a caller writes against", () => {
  it("rejects a misspelled operation at compile time", () => {
    // Not a runtime assertion: the value of naming operations in the type
    // system is that a typo never reaches a running site, and a test that only
    // checked the runtime refusal would pass just as happily without it.
    // @ts-expect-error — 'test-connectoin' is not an operation any vendor declares
    void (() => wcRequest({
      vendor: { configId: "cfg-a" },
      operation: "test-connectoin",
      args: undefined,
    }));
    expect(true).toBe(true);
  });
});
