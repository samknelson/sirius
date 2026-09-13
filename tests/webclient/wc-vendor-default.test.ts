import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Choosing a connection for a caller that never chose one.
 *
 * Callers like the T631 scheduled syncs name a vendor and an action and nothing
 * else, so something has to decide which of that vendor's connections they
 * meant. Picking the first of several by some ordering is the dangerous answer:
 * the T631 worker sync deactivates every worker absent from the response it was
 * handed, so two connections each answering for the other's members would take
 * turns deactivating them, and nothing would look broken. Refusing an ambiguous
 * default is therefore load-bearing, not tidiness, which is why it is pinned.
 */

const getByKindAndPlugin = vi.fn();
const getConfig = vi.fn();
const getPlugin = vi.fn();
const getEnvironmentVariable = vi.fn();

vi.mock("../../server/storage", () => ({
  storage: {
    pluginConfigs: {
      get: (id: string) => getConfig(id),
      getByKindAndPlugin: (kind: string, pluginId: string) =>
        getByKindAndPlugin(kind, pluginId),
    },
  },
}));

vi.mock("../../server/plugins/wc-vendors", () => ({
  getWcVendorPlugin: (id: string) => getPlugin(id),
}));

vi.mock("../../server/config/env-registry", () => ({
  registerEnvironmentVariable: vi.fn(),
  registerEnvironmentVariables: vi.fn(),
  getEnvironmentVariable: (name: string) => getEnvironmentVariable(name),
}));

const {
  resolveDefaultWcVendor,
  WcVendorNoDefaultError,
  WcVendorAmbiguousDefaultError,
} = await import("../../server/services/webclient/wc-vendor-context");

function config(id: string, enabled: boolean) {
  return {
    id,
    pluginKind: "wc-vendors",
    pluginId: "sitespecific-t631",
    enabled,
    data: { secretName: "T631_CREDENTIAL" },
  };
}

/** Whatever the plugin listing returned is what a by-id read then finds. */
function listing(configs: ReturnType<typeof config>[]) {
  getByKindAndPlugin.mockResolvedValue(configs);
  getConfig.mockImplementation(async (id: string) =>
    configs.find((c) => c.id === id),
  );
}

beforeEach(() => {
  getByKindAndPlugin.mockReset();
  getConfig.mockReset();
  getPlugin.mockReset();
  getEnvironmentVariable.mockReset();
  getPlugin.mockReturnValue({
    id: "sitespecific-t631",
    name: "Teamsters 631",
    requiresSecret: false,
    operations: {},
  });
});

describe("the default connection for a vendor", () => {
  it("is the one enabled connection", async () => {
    listing([config("a", true), config("b", false)]);
    const resolved = await resolveDefaultWcVendor("sitespecific-t631");
    expect(resolved.config.id).toBe("a");
  });

  it("does not exist when none is enabled, and says so", async () => {
    listing([config("a", false)]);
    await expect(resolveDefaultWcVendor("sitespecific-t631")).rejects.toBeInstanceOf(
      WcVendorNoDefaultError,
    );
  });

  it("does not exist when there are no connections at all", async () => {
    listing([]);
    await expect(resolveDefaultWcVendor("sitespecific-t631")).rejects.toBeInstanceOf(
      WcVendorNoDefaultError,
    );
  });

  it("is refused rather than guessed when several are enabled", async () => {
    listing([config("a", true), config("b", true)]);
    const error = await resolveDefaultWcVendor("sitespecific-t631").catch((e) => e);
    expect(error).toBeInstanceOf(WcVendorAmbiguousDefaultError);
    expect(error.configIds).toEqual(["a", "b"]);
    expect(error.status).toBe(409);
  });

  it("distinguishes the two refusals, because they need different fixes", async () => {
    listing([]);
    const none = await resolveDefaultWcVendor("sitespecific-t631").catch((e) => e);
    listing([config("a", true), config("b", true)]);
    const many = await resolveDefaultWcVendor("sitespecific-t631").catch((e) => e);

    expect(none).not.toBeInstanceOf(WcVendorAmbiguousDefaultError);
    expect(none.status).toBe(503);
    expect(none.message).not.toEqual(many.message);
  });
});
