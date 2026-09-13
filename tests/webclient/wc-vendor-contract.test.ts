import { beforeEach, describe, expect, it, vi } from "vitest";

const canStore = vi.hoisted(() => vi.fn());
const getConfig = vi.hoisted(() => vi.fn());

vi.mock("../../server/storage", () => ({
  storage: {
    pluginConfigs: {
      get: (id: string) => getConfig(id),
      getByKindAndPlugin: async () => [],
    },
  },
}));

vi.mock("../../server/storage/wc-cache", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../server/storage/wc-cache")>();
  return {
    ...actual,
    wcCacheStorage: {
      ...actual.wcCacheStorage,
      canStore,
    },
  };
});

import {
  getWcVendorOperationManifest,
  getWcVendorPlugin,
  registerWcVendorPluginKind,
} from "../../server/plugins/wc-vendors";
import { getPluginConfigAdapter } from "../../server/plugins/_core/config-adapter";
import { wcRequest } from "../../server/services/webclient";

registerWcVendorPluginKind();

beforeEach(() => {
  canStore.mockReset();
  canStore.mockResolvedValue(true);
  getConfig.mockReset();
  getConfig.mockResolvedValue({
    id: "dummy-config",
    pluginKind: "wc-vendors",
    pluginId: "dummy",
    enabled: true,
    name: "Dummy",
    data: {},
  });
});

function plugin(id: string) {
  const found = getWcVendorPlugin(id);
  if (!found) throw new Error(`wc-vendor plugin '${id}' is not registered`);
  return found;
}

describe("the wc-vendor plugin contract", () => {
  it("publishes stable operation ids, descriptions, and write requirements", () => {
    const stripe = getWcVendorOperationManifest(plugin("stripe"));
    expect(stripe).toContainEqual({
      id: "test-connection",
      description: "test connection",
      needsWritableDatabase: false,
    });
    expect(stripe).toContainEqual({
      id: "create-customer",
      description: "create a customer",
      needsWritableDatabase: true,
    });

    const t631 = getWcVendorOperationManifest(plugin("sitespecific-t631"));
    expect(t631).toContainEqual({
      id: "sirius_service_ping",
      description: "ping the T631 service",
      needsWritableDatabase: false,
    });
  });

  it("declares credential requirements instead of making each plugin add a field", () => {
    expect(plugin("stripe").credential).toEqual({
      secretName: "required",
      setupGuidance:
        "The named secret must contain one Stripe secret API key, for example sk_test_<your-key> or sk_live_<your-key>.",
    });
    expect(plugin("sitespecific-t631").credential).toEqual({
      secretName: "required",
      setupGuidance:
        "Enter the environment-secret name here, not a token or JSON value. The value stored in that secret must be a JSON object containing both T631 tokens:",
      setupExample:
        '{"accessToken":"<access-token>","employerToken":"<employer-token>"}',
    });
    expect(plugin("dummy").credential).toEqual({ secretName: "none" });
  });

  it("shows and requires the secret-name envelope field only when declared", () => {
    const adapter = getPluginConfigAdapter("wc-vendors");
    if (!adapter) throw new Error("wc-vendors config adapter is not registered");

    expect(adapter.envelopeFieldsForPlugin?.(plugin("stripe"))).toEqual([
      {
        name: "secretName",
        label: "Secret Name",
        type: "string",
        required: true,
        description:
          "The named secret must contain one Stripe secret API key, for example sk_test_<your-key> or sk_live_<your-key>.",
      },
    ]);
    expect(adapter.envelopeFieldsForPlugin?.(plugin("dummy"))).toEqual([]);
  });

  it("normalizes secret-name storage according to the declaration", () => {
    const adapter = getPluginConfigAdapter("wc-vendors");
    if (!adapter) throw new Error("wc-vendors config adapter is not registered");

    const dummyRows = adapter.toRows({
      pluginId: "dummy",
      enabled: true,
      name: "Dummy",
      data: { secretName: "LEGACY_DUMMY_SECRET", other: "kept" },
      secretName: "CRAFTED_DUMMY_SECRET",
    });
    expect(dummyRows.base.data).toEqual({ other: "kept" });

    const optionalPlugin = {
      id: "optional-contract-test",
      name: "Optional contract test",
      credential: { secretName: "optional" as const },
      operations: {},
    };
    const optionalRows = adapter.toRows({
      pluginId: optionalPlugin.id,
      enabled: true,
      name: optionalPlugin.name,
      data: { secretName: "OLD_OPTIONAL_SECRET", other: "kept" },
      secretName: null,
    });
    // An unregistered plugin is not treated as credential-free; null still
    // means an explicit clear and omission still preserves existing data.
    expect(optionalRows.base.data).toEqual({ other: "kept" });
  });

  it("enforces write requirements even for an in-process vendor", async () => {
    canStore.mockResolvedValue(false);

    const write = await wcRequest({
      vendor: { configId: "dummy-config" },
      operation: "create-customer",
      args: { name: "Test" },
    });
    // Nothing happened and the caller is told why, in the same shape every
    // other answer arrives in. It is not a failure of the vendor, so there is
    // no outcome to report — only a reason there is no answer.
    expect(write).toMatchObject({ source: "none", fresh: false });
    expect(write.error).toContain("could not be recorded");
    expect("outcome" in write).toBe(false);

    const read = await wcRequest({
      vendor: { configId: "dummy-config" },
      operation: "test-connection",
      args: undefined,
    });
    expect(read).toMatchObject({
      outcome: "success",
      value: { connected: true },
    });
  });

  it("is the only way to reach a vendor: the registry hands out no handler", () => {
    const dummy = plugin("dummy");
    const declaration = dummy.operations["create-customer"];
    if (!declaration) throw new Error("dummy operation is not registered");
    // What a registered plugin publishes is what it CAN do. A caller holding
    // one cannot make the call itself, and so cannot skip the refusal, the
    // write gate or the count that the framework applies around it.
    expect(Object.keys(declaration).sort()).toEqual([
      "description",
      "needsWritableDatabase",
    ]);
    expect((declaration as Record<string, unknown>).run).toBeUndefined();
  });
});