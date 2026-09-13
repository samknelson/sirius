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
const registerEnvironmentVariable = vi.fn();

vi.mock("../../server/storage", () => ({
  storage: {
    pluginConfigs: {
      get: (id: string) => getConfig(id),
      getByKindAndPlugin: (kind: string, pluginId: string) =>
        getByKindAndPlugin(kind, pluginId),
    },
  },
}));

vi.mock("../../server/plugins/wc-vendors/registry", () => ({
  getWcVendorPlugin: (id: string) => getPlugin(id),
  getWcVendorHandler: () => undefined,
}));

// Resolving a connection reads no table and makes no request, but the module
// it lives in sits next to the ones that do. These stand in for the storage
// the framework core imports, so this suite needs no database.
vi.mock("../../server/storage/transaction-context", () => ({
  runOutsideTransaction: (fn: () => unknown) => fn(),
  runInTransaction: vi.fn(),
}));
vi.mock("../../server/storage/wc-cache", () => ({
  wcCacheStorage: {},
  wcRequestKeyHash: () => "unused",
}));
vi.mock("../../server/storage/wc-stats", () => ({ wcStatsStorage: {} }));

vi.mock("../../server/config/env-registry", () => ({
  registerEnvironmentVariable: (definition: unknown) =>
    registerEnvironmentVariable(definition),
  registerEnvironmentVariables: vi.fn(),
  getEnvironmentVariable: (name: string) => getEnvironmentVariable(name),
}));

const {
  describeWcVendor,
  WcVendorNoDefaultError,
  WcVendorAmbiguousDefaultError,
} = await import("../../server/services/webclient/wc-vendor-context");

/** Ask for the vendor's default connection the way a caller that never chose one does. */
const describeDefault = (pluginId: string) => describeWcVendor({ pluginId });

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
  registerEnvironmentVariable.mockReset();
  getPlugin.mockReturnValue({
    id: "sitespecific-t631",
    name: "Teamsters 631",
    credential: { secretName: "required" },
    operations: {},
  });
});

describe("the default connection for a vendor", () => {
  it("is the one enabled connection", async () => {
    getEnvironmentVariable.mockReturnValue("configured-credential");
    listing([config("a", true), config("b", false)]);
    const resolved = await describeDefault("sitespecific-t631");
    expect(resolved.configId).toBe("a");
  });

  it("does not exist when none is enabled, and says so", async () => {
    listing([config("a", false)]);
    await expect(describeDefault("sitespecific-t631")).rejects.toBeInstanceOf(
      WcVendorNoDefaultError,
    );
  });

  it("does not exist when there are no connections at all", async () => {
    listing([]);
    await expect(describeDefault("sitespecific-t631")).rejects.toBeInstanceOf(
      WcVendorNoDefaultError,
    );
  });

  it("is refused rather than guessed when several are enabled", async () => {
    listing([config("a", true), config("b", true)]);
    const error = await describeDefault("sitespecific-t631").catch((e: any) => e);
    expect(error).toBeInstanceOf(WcVendorAmbiguousDefaultError);
    expect(error.configIds).toEqual(["a", "b"]);
    expect(error.status).toBe(409);
  });

  it("distinguishes the two refusals, because they need different fixes", async () => {
    listing([]);
    const none = await describeDefault("sitespecific-t631").catch((e: any) => e);
    listing([config("a", true), config("b", true)]);
    const many = await describeDefault("sitespecific-t631").catch((e: any) => e);

    expect(none).not.toBeInstanceOf(WcVendorAmbiguousDefaultError);
    expect(none.status).toBe(503);
    expect(none.message).not.toEqual(many.message);
  });
});

/**
 * Credential resolution has no visible result any more: what a caller gets
 * back is a description of the connection, deliberately without the
 * credential on it. What IS visible is whether the connection resolved at all
 * and what the env registry was asked for, which is the whole of the
 * declaration's effect.
 */
describe("vendor credential declarations", () => {
  it("refuses a required secret that is not set", async () => {
    const cfg = config("required", true);
    getConfig.mockResolvedValue(cfg);
    getEnvironmentVariable.mockReturnValue(undefined);

    const error = await describeWcVendor({ configId: cfg.id }).catch(
      (e: any) => e,
    );

    expect(error.status).toBe(503);
    expect(error.message).toContain("T631_CREDENTIAL");
  });

  it("resolves an optional credential as empty when it is not set", async () => {
    const cfg = config("optional", true);
    getConfig.mockResolvedValue(cfg);
    getPlugin.mockReturnValue({
      id: "sitespecific-t631",
      name: "Optional vendor",
      credential: { secretName: "optional" },
      operations: {},
    });
    getEnvironmentVariable.mockReturnValue(undefined);

    const described = await describeWcVendor({ configId: cfg.id });

    // The connection is usable, and the secret it names was still registered
    // and read — an unset optional credential is an empty one, not a refusal.
    expect(described.configId).toBe(cfg.id);
    expect(registerEnvironmentVariable).toHaveBeenCalledWith(
      expect.objectContaining({ name: "T631_CREDENTIAL", secret: true }),
    );
    expect(getEnvironmentVariable).toHaveBeenCalledWith("T631_CREDENTIAL");
  });

  it("does not resolve or register a secret for a credential-free vendor", async () => {
    const cfg = { ...config("none", true), data: {} };
    getConfig.mockResolvedValue(cfg);
    getPlugin.mockReturnValue({
      id: "dummy",
      name: "Dummy",
      credential: { secretName: "none" },
      operations: {},
    });

    const described = await describeWcVendor({ configId: cfg.id });

    expect(described.pluginId).toBe("dummy");
    expect(registerEnvironmentVariable).not.toHaveBeenCalled();
    expect(getEnvironmentVariable).not.toHaveBeenCalled();
  });

  it("describes a connection without handing over its credential", async () => {
    const cfg = config("described", true);
    getConfig.mockResolvedValue(cfg);
    getEnvironmentVariable.mockReturnValue("configured-credential");

    const described = await describeWcVendor({ configId: cfg.id });

    expect(JSON.stringify(described)).not.toContain("configured-credential");
    expect(described).not.toHaveProperty("context");
    expect(described).not.toHaveProperty("credential");
  });
});
