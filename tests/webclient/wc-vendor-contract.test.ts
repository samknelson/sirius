import { beforeEach, describe, expect, it, vi } from "vitest";

const canStore = vi.hoisted(() => vi.fn());
const getConfig = vi.hoisted(() => vi.fn());
const cacheRead = vi.hoisted(() => vi.fn());
const cacheWriteSuccess = vi.hoisted(() => vi.fn());
const cacheWriteFailure = vi.hoisted(() => vi.fn());
const cachedRun = vi.hoisted(() => vi.fn());

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
      read: cacheRead,
      writeSuccess: cacheWriteSuccess,
      writeFailure: cacheWriteFailure,
    },
  };
});

import {
  getWcVendorOperationManifest,
  getWcVendorPlugin,
  registerWcVendorPluginKind,
} from "../../server/plugins/wc-vendors";
import { registerWcVendorPlugin } from "../../server/plugins/wc-vendors/registry";
import { getPluginConfigAdapter } from "../../server/plugins/_core/config-adapter";
import { getWcRequest, wcRequest } from "../../server/services/webclient";
import {
  MaintenanceModeError,
  setMaintenanceActive,
} from "../../server/services/maintenance-flag";

declare module "../../server/plugins/wc-vendors/types" {
  interface WcVendorOperations {
    "cached-contract-test": {
      args: { address: string; region?: string };
      result: { normalized: string };
    };
    "uncached-contract-test": {
      args: { value: string };
      result: { value: string };
    };
  }
}

registerWcVendorPluginKind();
registerWcVendorPlugin({
  id: "cached-contract-fixture",
  name: "Cached contract fixture",
  description: "Exercises cached and uncached operation registration.",
  credential: { secretName: "none" },
  service: "Google",
  operations: {
    "cached-contract-test": {
      description: "exercise a cached vendor operation",
      needsWritableDatabase: true,
      cache: {
        mode: "cached",
        freshFor: 60_000,
        failureRememberedFor: 5_000,
        requestKey: ({ address, region }) =>
          [
            address.trim().replace(/\s+/g, " ").toUpperCase(),
            region?.trim().toUpperCase(),
          ]
            .filter(Boolean)
            .join("|"),
      },
      run: cachedRun,
    },
    "uncached-contract-test": {
      description: "exercise an explicitly uncached vendor operation",
      needsWritableDatabase: false,
      cache: { mode: "uncached" },
      async run(_ctx, args) {
        return { value: args.value };
      },
    },
  },
});

beforeEach(() => {
  canStore.mockReset();
  canStore.mockResolvedValue(true);
  cacheRead.mockReset();
  cacheRead.mockResolvedValue(undefined);
  cacheWriteSuccess.mockReset();
  cacheWriteSuccess.mockResolvedValue(undefined);
  cacheWriteFailure.mockReset();
  cacheWriteFailure.mockResolvedValue(undefined);
  cachedRun.mockReset();
  cachedRun.mockImplementation(async (_ctx, args) => ({
    answered: true,
    value: { normalized: args.address.trim().toUpperCase() },
  }));
  setMaintenanceActive(false);
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
      cacheMode: "uncached",
      manualRun: {
        argsSchema: { type: "object", properties: {}, additionalProperties: false },
        effect: "read",
      },
    });
    expect(stripe).toContainEqual({
      id: "create-customer",
      description: "create a customer",
      needsWritableDatabase: true,
      cacheMode: "uncached",
    });

    const t631 = getWcVendorOperationManifest(plugin("sitespecific-t631"));
    expect(t631).toContainEqual({
      id: "sirius_service_ping",
      description: "ping the T631 service",
      needsWritableDatabase: false,
      cacheMode: "uncached",
      manualRun: {
        argsSchema: { type: "object", properties: {}, additionalProperties: false },
        effect: "read",
      },
    });
  });

  it("publishes only the reviewed simple read operations for manual execution", () => {
    const emptyArgs = {
      type: "object",
      properties: {},
      additionalProperties: false,
    };
    const stringArgs = (name: string, title: string) => ({
      type: "object",
      properties: {
        [name]: { type: "string", title, minLength: 1, pattern: "\\S" },
      },
      required: [name],
      additionalProperties: false,
    });
    const expectManualRead = (
      pluginId: string,
      operationId: string,
      argsSchema: Record<string, unknown>,
    ) => {
      expect(getWcVendorOperationManifest(plugin(pluginId))).toContainEqual(
        expect.objectContaining({
          id: operationId,
          manualRun: { argsSchema, effect: "read" },
        }),
      );
    };

    expectManualRead("twilio", "read-configuration", emptyArgs);
    expectManualRead(
      "twilio",
      "validate-phone",
      stringArgs("phoneNumber", "Phone number"),
    );
    expectManualRead("twilio", "list-phone-numbers", emptyArgs);
    expectManualRead(
      "lob",
      "letter-status",
      stringArgs("letterId", "Letter ID"),
    );
    expectManualRead(
      "stripe",
      "retrieve-customer",
      stringArgs("customerRef", "Customer reference"),
    );
    expectManualRead(
      "stripe",
      "get-customer-details",
      stringArgs("customerRef", "Customer reference"),
    );
    expectManualRead(
      "stripe",
      "get-method-summary",
      stringArgs("methodRef", "Payment method reference"),
    );
    expectManualRead(
      "stripe",
      "get-method-details",
      stringArgs("methodRef", "Payment method reference"),
    );
    expectManualRead(
      "dummy",
      "get-customer-details",
      stringArgs("customerRef", "Customer reference"),
    );
    expectManualRead(
      "dummy",
      "get-method-summary",
      stringArgs("methodRef", "Payment method reference"),
    );
    expectManualRead(
      "dummy",
      "get-method-details",
      stringArgs("methodRef", "Payment method reference"),
    );
    expectManualRead(
      "sitespecific-freeman-authorization",
      "ping",
      emptyArgs,
    );
    expect(getWcRequest("Twilio", "validate-phone")).toMatchObject({
      cached: true,
      needsWritableDatabase: true,
    });

    for (const [pluginId, operationId] of [
      ["twilio", "send-sms"],
      ["lob", "send-letter"],
      ["lob", "cancel-letter"],
      ["stripe", "create-customer"],
      ["stripe", "detach-method"],
      ["sitespecific-freeman-authorization", "authorize-bearer"],
    ]) {
      const operation = getWcVendorOperationManifest(plugin(pluginId)).find(
        ({ id }) => id === operationId,
      );
      expect(operation?.manualRun).toBeUndefined();
    }
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
      "cacheMode",
      "description",
      "needsWritableDatabase",
    ]);
    expect((declaration as unknown as Record<string, unknown>).run).toBeUndefined();
    expect((declaration as unknown as Record<string, unknown>).cache).toBeUndefined();
  });

  it("registers cached and explicit uncached operations with the shared framework", () => {
    const cached = getWcRequest("Google", "cached-contract-test");
    expect(cached).toMatchObject({
      cached: true,
      needsWritableDatabase: true,
      freshFor: 60_000,
      failureRememberedFor: 5_000,
    });
    expect(
      cached?.requestKey({
        configId: "connection-a",
        args: { address: "  10 main st ", region: " us " },
      }),
    ).toBe("connection-a:10 MAIN ST|US");

    const uncached = getWcRequest("Google", "uncached-contract-test");
    expect(uncached).toMatchObject({
      cached: false,
      needsWritableDatabase: false,
    });
  });

  it("stores a cached handler's answer envelope under the per-connection key", async () => {
    getConfig.mockResolvedValue({
      id: "cached-config",
      pluginKind: "wc-vendors",
      pluginId: "cached-contract-fixture",
      enabled: true,
      name: "Cached fixture",
      data: {},
    });

    const result = await wcRequest({
      vendor: { configId: "cached-config" },
      operation: "cached-contract-test",
      args: { address: " 10 main st " },
    });

    expect(result).toMatchObject({
      source: "network",
      outcome: "success",
      value: { normalized: "10 MAIN ST" },
    });
    expect(cacheWriteSuccess).toHaveBeenCalledWith(
      "Google",
      "cached-contract-test",
      "cached-config:10 MAIN ST",
      { normalized: "10 MAIN ST" },
    );
  });

  it("serves cached vendor answers during maintenance but refuses a required call", async () => {
    getConfig.mockResolvedValue({
      id: "cached-config",
      pluginKind: "wc-vendors",
      pluginId: "cached-contract-fixture",
      enabled: true,
      name: "Cached fixture",
      data: {},
    });
    setMaintenanceActive(true);
    cacheRead.mockResolvedValue({
      outcome: "success",
      response: { normalized: "10 MAIN ST" },
      fetchedAt: new Date(),
    });

    const stored = await wcRequest({
      vendor: { configId: "cached-config" },
      operation: "cached-contract-test",
      args: { address: "10 main st" },
    });
    expect(stored).toMatchObject({
      source: "cache",
      outcome: "success",
      value: { normalized: "10 MAIN ST" },
    });
    expect(cachedRun).not.toHaveBeenCalled();

    cacheRead.mockResolvedValue(undefined);
    await expect(
      wcRequest({
        vendor: { configId: "cached-config" },
        operation: "cached-contract-test",
        args: { address: "11 main st" },
      }),
    ).rejects.toBeInstanceOf(MaintenanceModeError);
  });
});