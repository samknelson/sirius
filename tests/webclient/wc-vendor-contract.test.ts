import { beforeEach, describe, expect, it, vi } from "vitest";

const canStore = vi.hoisted(() => vi.fn());

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

registerWcVendorPluginKind();

beforeEach(() => {
  canStore.mockReset();
  canStore.mockResolvedValue(true);
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
        'The named secret must contain a JSON object with both tokens, for example {"accessToken":"<access-token>","employerToken":"<employer-token>"}.',
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
    const dummy = plugin("dummy");
    const write = dummy.operations["create-customer"];
    const read = dummy.operations["test-connection"];
    if (!write || !read) throw new Error("dummy operation is not registered");
    const context = {
      credential: { value: "" },
      config: { id: "dummy", data: {} },
    } as any;

    canStore.mockResolvedValue(false);
    await expect(write.run(context, { name: "Test" })).rejects.toMatchObject({
      status: 503,
    });
    await expect(read.run(context, undefined as never)).resolves.toMatchObject({
      connected: true,
    });
  });
});