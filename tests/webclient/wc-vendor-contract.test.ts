import { beforeEach, describe, expect, it, vi } from "vitest";

const canStore = vi.hoisted(() => vi.fn());
const getConfig = vi.hoisted(() => vi.fn());
const getConfigsByKind = vi.hoisted(() => vi.fn());
const cacheRead = vi.hoisted(() => vi.fn());
const cacheWriteSuccess = vi.hoisted(() => vi.fn());
const cacheWriteFailure = vi.hoisted(() => vi.fn());
const cachedRun = vi.hoisted(() => vi.fn());
const componentEnabled = vi.hoisted(() => vi.fn());
const getConfigsByPlugin = vi.hoisted(() => vi.fn());

vi.mock("../../server/storage", () => ({
  storage: {
    pluginConfigs: {
      get: (id: string) => getConfig(id),
      getByKind: (kind: string) => getConfigsByKind(kind),
      getByKindAndPlugin: (kind: string, pluginId: string) =>
        getConfigsByPlugin(kind, pluginId),
    },
  },
}));

vi.mock("../../server/plugins/_core/gating", () => ({
  isPluginComponentEnabledAsync: (plugin: unknown) => componentEnabled(plugin),
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
  canonicalizeWcVendorAssignmentData,
  canonicalizeWcUsageAlertRulesData,
  normalizeWcConnectionTestResult,
} from "../../server/plugins/wc-vendors";
import {
  getWcVendorHandler,
  registerWcVendorPlugin,
} from "../../server/plugins/wc-vendors/registry";
import { getPluginConfigAdapter } from "../../server/plugins/_core/config-adapter";
import { getWcRequest, wcRequest } from "../../server/services/webclient";
import {
  describeWcVendor,
  hasWcVendorOperation,
} from "../../server/services/webclient/wc-vendor-context";
import {
  MaintenanceModeError,
  setMaintenanceActive,
} from "../../server/services/maintenance-flag";

declare module "../../server/plugins/wc-vendors/types" {
  interface WcVendorOperations {
    "tests.cache.answer": {
      args: { address: string; region?: string };
      result: { normalized: string };
    };
    "tests.answer": {
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
  service: "Census",
  requiredComponent: "contract.component",
  operations: {
    "service.test-connection": {
      description: "test the Census Geocoder connection",
      needsWritableDatabase: false,
      run: async () => ({ status: "connected" as const }),
    },
    "tests.cache.answer": {
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
    "tests.answer": {
      description: "exercise an explicitly uncached vendor operation",
      needsWritableDatabase: false,
      cache: { mode: "uncached" },
      async run(_ctx, args) {
        return { value: args.value };
      },
    },
  },
});
registerWcVendorPlugin({
  id: "disabled-routing-contract-fixture",
  name: "Disabled routing contract fixture",
  description: "Exercises component-aware automatic routing.",
  credential: { secretName: "none" },
  requiredComponent: "disabled.contract.component",
  operations: {
    "service.test-connection": {
      description: "test the fixture connection",
      needsWritableDatabase: false,
      run: async () => ({ status: "connected" as const }),
    },
    "tests.answer": {
      description: "exercise a disabled automatic-routing candidate",
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
  componentEnabled.mockReset();
  componentEnabled.mockResolvedValue(true);
  getConfig.mockReset();
  getConfig.mockResolvedValue({
    id: "dummy-config",
    pluginKind: "wc-vendors",
    pluginId: "dummy",
    enabled: true,
    name: "Dummy",
    data: {},
  });
  getConfigsByKind.mockReset();
  getConfigsByKind.mockResolvedValue([]);
  getConfigsByPlugin.mockReset();
  getConfigsByPlugin.mockResolvedValue([]);
});

function plugin(id: string) {
  const found = getWcVendorPlugin(id);
  if (!found) throw new Error(`wc-vendor plugin '${id}' is not registered`);
  return found;
}

describe("the wc-vendor plugin contract", () => {
  it("normalizes legacy connection results without leaking provider fields", () => {
    expect(normalizeWcConnectionTestResult({ connected: true })).toEqual({
      status: "connected",
    });
    expect(
      normalizeWcConnectionTestResult({
        connected: false,
        error: "API key is not configured",
        secret: "must-not-escape",
      }),
    ).toEqual({
      status: "misconfigured",
      error: { message: "API key is not configured" },
    });
    expect(normalizeWcConnectionTestResult({ unsupported: true })).toMatchObject({
      status: "unsupported",
    });
    const canary = "credential-canary-should-not-escape";
    expect(
      normalizeWcConnectionTestResult(
        {
          connected: false,
          error: {
            message: `credential ${canary} was rejected`,
            type: "private-provider-error",
            code: "private-code",
            details: { credential: canary },
          },
          account: {
            id: canary,
            email: "operator@example.test",
            privateToken: canary,
            capabilities: [
              { label: `token ${canary}`, enabled: true, private: canary },
              { label: "discard malformed", enabled: "yes" },
            ],
          },
          balances: [
            { label: canary, amount: 1, currency: "USD", secret: canary },
          ],
          privateTopLevel: canary,
        },
        canary,
      ),
    ).toEqual({
      status: "misconfigured",
      error: {
        message: "credential [redacted] was rejected",
        type: "private-provider-error",
        code: "private-code",
      },
      account: {
        id: "[redacted]",
        email: "operator@example.test",
        capabilities: [{ label: "token [redacted]", enabled: true }],
      },
      balances: [{ label: "[redacted]", amount: 1, currency: "USD" }],
    });
  });

  it("migrates legacy assignment ids idempotently while preserving settings and secrets", () => {
    const data = {
      secretName: "STRIPE_SECRET",
      enabledSetting: true,
      operations: ["create-customer", "attach-method", "create-customer"],
    };
    const migrated = canonicalizeWcVendorAssignmentData(data);
    expect(migrated).toEqual({
      secretName: "STRIPE_SECRET",
      enabledSetting: true,
      operations: [
        "payments.customer.create",
        "payments.payment-method.attach",
      ],
    });
    expect(canonicalizeWcVendorAssignmentData(migrated)).toBe(migrated);
  });

  it("migrates usage-alert rule operation ids without touching whole-service or unknown rules", () => {
    const data = {
      recipients: ["admin@example.test"],
      rules: [
        {
          service: "Twilio",
          requestType: "phone-lookup",
          threshold: 1,
          privateRuleField: "keep",
        },
        {
          service: "Lob",
          requestType: "send-letter",
          threshold: 2,
        },
        { service: "Twilio", threshold: 1000, wholeService: true },
        { service: "Future", requestType: "future.operation", threshold: 3 },
      ],
      unrelated: { preserve: true },
    };
    const migrated = canonicalizeWcUsageAlertRulesData(data);
    expect(migrated).toEqual({
      recipients: ["admin@example.test"],
      rules: [
        {
          service: "Twilio",
          requestType: "communications.phone.validate",
          threshold: 1,
          privateRuleField: "keep",
        },
        {
          service: "Lob",
          requestType: "communications.postal.send",
          threshold: 2,
        },
        { service: "Twilio", threshold: 1000, wholeService: true },
        { service: "Future", requestType: "future.operation", threshold: 3 },
      ],
      unrelated: { preserve: true },
    });
    expect(canonicalizeWcUsageAlertRulesData(migrated)).toBe(migrated);
    expect((migrated.rules as unknown[])[2]).toBe(data.rules[2]);
    expect((migrated.rules as unknown[])[3]).toBe(data.rules[3]);
  });

  it("rejects duplicate plugin ids before replacing the registered handler", () => {
    const before = getWcVendorPlugin("cached-contract-fixture");
    const handlerBefore = getWcVendorHandler(
      "cached-contract-fixture",
      "service.test-connection",
    );
    expect(() =>
      registerWcVendorPlugin({
        id: "cached-contract-fixture",
        name: "replacement",
        description: "Replacement fixture",
        credential: { secretName: "none" },
        operations: {
          "service.test-connection": {
            description: "replacement",
            needsWritableDatabase: false,
            run: async () => ({ status: "connected" as const }),
          },
        },
      }),
    ).toThrow(/already registered/);
    expect(getWcVendorPlugin("cached-contract-fixture")).toBe(before);
    expect(getWcVendorHandler("cached-contract-fixture", "service.test-connection"))
      .toBe(handlerBefore);
  });

  it("preflights service behavior conflicts before registering a new plugin", () => {
    expect(() =>
      registerWcVendorPlugin({
        id: "conflicting-service-test-fixture",
        name: "Conflicting service fixture",
        description: "Conflicting service fixture",
        credential: { secretName: "none" },
        service: "Census",
        operations: {
          "service.test-connection": {
            description: "a different Google connection probe",
            needsWritableDatabase: false,
            run: async () => ({ status: "connected" as const }),
          },
        },
      }),
    ).toThrow(/conflicting metadata/);
    expect(getWcVendorPlugin("conflicting-service-test-fixture")).toBeUndefined();
    expect(
      getWcVendorHandler(
        "conflicting-service-test-fixture",
        "service.test-connection",
      ),
    ).toBeUndefined();
  });

  it("refuses a disabled required component for every target before reaching the handler", async () => {
    const row = {
      id: "cached-config",
      pluginKind: "wc-vendors",
      pluginId: "cached-contract-fixture",
      enabled: true,
      name: "Cached fixture",
      data: { operations: ["tests.cache.answer"] },
    };
    getConfig.mockResolvedValue(row);
    getConfigsByKind.mockResolvedValue([row]);
    getConfigsByPlugin.mockResolvedValue([row]);
    componentEnabled.mockResolvedValue(false);

    await expect(
      wcRequest({
        vendor: { configId: row.id },
        operation: "tests.cache.answer",
        args: { address: "10 main st" },
      }),
    ).rejects.toMatchObject({
      status: 403,
      message: "Component 'contract.component' not enabled",
    });
    await expect(
      wcRequest({
        vendor: { pluginId: row.pluginId },
        operation: "tests.cache.answer",
        args: { address: "10 main st" },
      }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      wcRequest({
        vendor: { any: true },
        operation: "tests.cache.answer",
        args: { address: "10 main st" },
      }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      describeWcVendor(
        { configId: row.id },
        "tests.cache.answer",
      ),
    ).rejects.toMatchObject({ status: 403 });
    await expect(hasWcVendorOperation("tests.cache.answer")).resolves.toBe(false);

    expect(cachedRun).not.toHaveBeenCalled();
    expect(cacheRead).not.toHaveBeenCalled();
  });

  it("rejects unsupported operations before reaching any vendor handler", async () => {
    getConfig.mockResolvedValue({
      id: "cached-config",
      pluginKind: "wc-vendors",
      pluginId: "cached-contract-fixture",
      enabled: true,
      name: "Cached fixture",
      data: {},
    });

    await expect(
      wcRequest({
        vendor: { configId: "cached-config" },
        operation: "not-registered" as never,
        args: undefined as never,
      }),
    ).rejects.toMatchObject({ status: 501 });
    expect(cachedRun).not.toHaveBeenCalled();
    expect(cacheRead).not.toHaveBeenCalled();
  });

  it("refuses ambiguous automatic operation assignments", async () => {
    const assigned = (id: string, pluginId: string) => ({
      id,
      pluginKind: "wc-vendors",
      pluginId,
      enabled: true,
      name: id,
      data: { operations: ["tests.cache.answer"] },
    });
    getConfigsByKind.mockResolvedValue([
      assigned("one", "cached-contract-fixture"),
      assigned("two", "cached-contract-fixture"),
    ]);

    await expect(
      wcRequest({
        vendor: { any: true },
        operation: "tests.cache.answer",
        args: { address: "10 main st" },
      }),
    ).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining(
        "Multiple enabled webclient vendor configurations are assigned",
      ),
    });
    expect(getConfig).not.toHaveBeenCalled();
    expect(cachedRun).not.toHaveBeenCalled();
  });

  it("does not let a component-disabled assignment make an available route ambiguous", async () => {
    const assigned = (id: string, pluginId: string) => ({
      id,
      pluginKind: "wc-vendors",
      pluginId,
      enabled: true,
      name: id,
      data: { operations: ["tests.cache.answer"] },
    });
    const usable = assigned("usable", "cached-contract-fixture");
    const disabled = assigned("disabled", "disabled-routing-contract-fixture");
    usable.data.operations = ["tests.answer"];
    disabled.data.operations = ["tests.answer"];
    getConfigsByKind.mockResolvedValue([usable, disabled]);
    getConfig.mockResolvedValue(usable);
    componentEnabled.mockImplementation(async (plugin) =>
      plugin.id !== "disabled-routing-contract-fixture",
    );

    await expect(hasWcVendorOperation("tests.answer")).resolves.toBe(true);
    await expect(
      wcRequest({
        vendor: { any: true },
        operation: "tests.answer",
        args: { value: "routed" },
      }),
    ).resolves.toMatchObject({
      outcome: "success",
      value: { value: "routed" },
    });
  });

  it("rejects invalid explicit configurations before reaching the handler", async () => {
    for (const [row, status] of [
      [undefined, 404],
      [
        {
          id: "wrong-kind",
          pluginKind: "other",
          pluginId: "cached-contract-fixture",
          enabled: true,
          data: {},
        },
        404,
      ],
      [
        {
          id: "disabled",
          pluginKind: "wc-vendors",
          pluginId: "cached-contract-fixture",
          enabled: false,
          data: {},
        },
        409,
      ],
    ] as const) {
      getConfig.mockResolvedValueOnce(row);
      await expect(
        wcRequest({
          vendor: { configId: row?.id ?? "missing" },
          operation: "tests.cache.answer",
          args: { address: "10 main st" },
        }),
      ).rejects.toMatchObject({ status });
    }

    expect(componentEnabled).not.toHaveBeenCalled();
    expect(cachedRun).not.toHaveBeenCalled();
    expect(cacheRead).not.toHaveBeenCalled();
  });

  it("keeps explicit selection independent from automatic operation assignment", async () => {
    getConfig.mockResolvedValue({
      id: "cached-config",
      pluginKind: "wc-vendors",
      pluginId: "cached-contract-fixture",
      enabled: true,
      name: "Cached fixture",
      data: {},
    });

    await expect(
      wcRequest({
        vendor: { any: true },
        operation: "tests.cache.answer",
        args: { address: "10 main st" },
      }),
    ).rejects.toMatchObject({ status: 501 });

    const explicit = await wcRequest({
      vendor: { configId: "cached-config" },
      operation: "tests.cache.answer",
      args: { address: "10 main st" },
    });
    expect(explicit).toMatchObject({
      source: "network",
      outcome: "success",
      value: { normalized: "10 MAIN ST" },
    });
    expect(cachedRun).toHaveBeenCalledTimes(1);
  });

  it("leaves existing unassigned configurations fail-closed for automatic routing", async () => {
    getConfigsByKind.mockResolvedValue([
      {
        id: "legacy-twilio-config",
        pluginKind: "wc-vendors",
        pluginId: "twilio",
        enabled: true,
        name: "Legacy Twilio",
        data: {},
      },
    ]);

    await expect(
      wcRequest({
        vendor: { any: true },
        operation: "communications.sms.send",
        args: {
          to: "+17025550100",
          body: "Test",
          statusCallbackUrl: "https://example.test/status",
        },
      }),
    ).rejects.toMatchObject({
      status: 501,
      message: expect.stringContaining(
        "No enabled webclient vendor configuration is assigned to 'communications.sms.send'",
      ),
    });
    expect(getConfig).not.toHaveBeenCalled();
  });

  it("publishes stable operation ids, descriptions, and write requirements", () => {
    const stripe = getWcVendorOperationManifest(plugin("stripe"));
    expect(stripe).toContainEqual({
      id: "service.test-connection",
      description: "test connection",
      needsWritableDatabase: false,
      externalSideEffect: false,
      cacheMode: "uncached",
      manualRun: {
        argsSchema: { type: "object", properties: {}, additionalProperties: false },
        effect: "read",
      },
    });
    expect(stripe).toContainEqual({
      id: "payments.customer.create",
      description: "create a customer",
      needsWritableDatabase: true,
      externalSideEffect: true,
      cacheMode: "uncached",
    });

    const t631 = getWcVendorOperationManifest(plugin("sitespecific-t631"));
    expect(t631).toContainEqual({
      id: "sitespecific.t631.service.ping",
      description: "ping the T631 service",
      needsWritableDatabase: false,
      externalSideEffect: true,
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

    expectManualRead("twilio", "communications.sms.configuration.read", emptyArgs);
    expectManualRead(
      "twilio",
      "communications.phone.validate",
      stringArgs("phoneNumber", "Phone number"),
    );
    expectManualRead("twilio", "communications.phone.list", emptyArgs);
    expectManualRead(
      "lob",
      "communications.postal.letter.status",
      stringArgs("letterId", "Letter ID"),
    );
    expectManualRead(
      "stripe",
      "payments.customer.retrieve",
      stringArgs("customerRef", "Customer reference"),
    );
    expectManualRead(
      "stripe",
      "payments.customer.details",
      stringArgs("customerRef", "Customer reference"),
    );
    expectManualRead(
      "stripe",
      "payments.payment-method.summary",
      stringArgs("methodRef", "Payment method reference"),
    );
    expectManualRead(
      "stripe",
      "payments.payment-method.details",
      stringArgs("methodRef", "Payment method reference"),
    );
    expectManualRead(
      "dummy",
      "payments.customer.details",
      stringArgs("customerRef", "Customer reference"),
    );
    expectManualRead(
      "dummy",
      "payments.payment-method.summary",
      stringArgs("methodRef", "Payment method reference"),
    );
    expectManualRead(
      "dummy",
      "payments.payment-method.details",
      stringArgs("methodRef", "Payment method reference"),
    );
    expectManualRead(
      "sitespecific-freeman-authorization",
      "service.test-connection",
      emptyArgs,
    );
    expect(getWcVendorOperationManifest(
      plugin("sitespecific-freeman-authorization"),
    )).toContainEqual(expect.objectContaining({
      id: "sitespecific.freeman.authorization.bearer",
      manualRun: {
        argsSchema: stringArgs("bearerCredential", "Bearer credential"),
        uiSchema: {
          bearerCredential: {
            "ui:widget": "password",
          },
        },
        effect: "read",
      },
    }));
    expect(getWcRequest("Twilio", "communications.phone.validate")).toMatchObject({
      cached: true,
      needsWritableDatabase: true,
    });

    for (const [pluginId, operationId] of [
      ["twilio", "communications.sms.send"],
      ["lob", "communications.postal.send"],
      ["lob", "communications.postal.letter.cancel"],
      ["stripe", "payments.customer.create"],
      ["stripe", "payments.payment-method.detach"],
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

  it("shows credential and automatic-operation envelope fields from declarations", () => {
    const adapter = getPluginConfigAdapter("wc-vendors");
    if (!adapter) throw new Error("wc-vendors config adapter is not registered");

    const kindOperations = adapter.envelopeFields?.find(
      ({ name }) => name === "operations",
    );
    const stripeFields = adapter.envelopeFieldsForPlugin?.(plugin("stripe")) ?? [];
    const stripeOperations = stripeFields.find(({ name }) => name === "operations");
    expect({
      ...kindOperations,
      options: undefined,
    }).toEqual({
      ...stripeOperations,
      options: undefined,
    });
    expect(stripeOperations?.options?.choices).toEqual(
      Object.entries(plugin("stripe").operations).map(([value, operation]) => ({
        value,
        label: operation.description,
      })),
    );
    expect(stripeFields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
        name: "secretName",
        label: "Secret Name",
        required: true,
        description:
          "The named secret must contain one Stripe secret API key, for example sk_test_<your-key> or sk_live_<your-key>.",
        }),
        expect.objectContaining({
          name: "operations",
          label: "Assigned operations",
          description:
            "Used only when application code requests any eligible configuration for an operation. Manual runs and explicitly selected configurations are not restricted by this list.",
          multiple: true,
        }),
      ]),
    );

    const dummyFields = adapter.envelopeFieldsForPlugin?.(plugin("dummy")) ?? [];
    expect(dummyFields).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "secretName" })]),
    );
    expect(dummyFields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "operations",
          label: "Assigned operations",
          description:
            "Used only when application code requests any eligible configuration for an operation. Manual runs and explicitly selected configurations are not restricted by this list.",
          multiple: true,
        }),
      ]),
    );
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
      operation: "payments.customer.create",
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
      operation: "service.test-connection",
      args: undefined,
    });
    expect(read).toMatchObject({
      outcome: "success",
      value: { status: "connected" },
    });
  });

  it("is the only way to reach a vendor: the registry hands out no handler", () => {
    const dummy = plugin("dummy");
    const declaration = dummy.operations["payments.customer.create"];
    if (!declaration) throw new Error("dummy operation is not registered");
    // What a registered plugin publishes is what it CAN do. A caller holding
    // one cannot make the call itself, and so cannot skip the refusal, the
    // write gate or the count that the framework applies around it.
    expect(Object.keys(declaration).sort()).toEqual([
      "cacheMode",
      "description",
      "externalSideEffect",
      "needsWritableDatabase",
    ]);
    expect((declaration as unknown as Record<string, unknown>).run).toBeUndefined();
    expect((declaration as unknown as Record<string, unknown>).cache).toBeUndefined();
  });

  it("registers cached and explicit uncached operations with the shared framework", () => {
    const cached = getWcRequest("Census", "tests.cache.answer");
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
    ).toBe("10 MAIN ST|US");

    const uncached = getWcRequest("Census", "tests.answer");
    expect(uncached).toMatchObject({
      cached: false,
      needsWritableDatabase: false,
    });
  });

  it("stores a cached handler's answer with connection provenance", async () => {
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
      operation: "tests.cache.answer",
      args: { address: " 10 main st " },
    });

    expect(result).toMatchObject({
      source: "network",
      outcome: "success",
      value: { normalized: "10 MAIN ST" },
    });
    expect(cacheWriteSuccess).toHaveBeenCalledWith(
      "Census",
      "cached-config",
      "tests.cache.answer",
      "10 MAIN ST",
      { normalized: "10 MAIN ST" },
    );
  });

  it("reuses one cached answer after switching provider and configuration", async () => {
    const requestType = "tests.provider-switch";
    const { registerWcRequest } = await import("../../server/services/webclient/registry");
    for (const service of ["OpenStates", "Freeman Authorization"] as const) {
      registerWcRequest({
        service,
        requestType,
        operation: "exercise provider-neutral cache identity",
        cached: true,
        freshFor: 60_000,
        failureRememberedFor: 5_000,
        requestKey: (args: { subject: string }) => args.subject.trim().toUpperCase(),
      });
    }
    const firstFetch = vi.fn(async () => ({
      answered: true as const,
      value: { normalized: "10 MAIN ST" },
    }));
    const first = await wcRequest({
      service: "OpenStates",
      configurationId: "first-config",
      requestType,
      args: { subject: "10 main st" },
      fetch: firstFetch,
    });
    expect(first).toMatchObject({ source: "network", outcome: "success" });
    expect(cacheWriteSuccess).toHaveBeenCalledWith(
      "OpenStates",
      "first-config",
      requestType,
      "10 MAIN ST",
      { normalized: "10 MAIN ST" },
    );

    cacheRead.mockResolvedValue({
      service: "OpenStates",
      configurationId: "first-config",
      requestType,
      requestKey: "10 MAIN ST",
      outcome: "success",
      response: { normalized: "10 MAIN ST" },
      fetchedAt: new Date(),
    });
    const secondFetch = vi.fn();

    await expect(wcRequest({
      service: "Freeman Authorization",
      configurationId: "second-config",
      requestType,
      args: { subject: "10 main st" },
      fetch: secondFetch,
    })).resolves.toMatchObject({
      source: "cache",
      outcome: "success",
      value: { normalized: "10 MAIN ST" },
    });
    expect(cacheRead).toHaveBeenLastCalledWith(
      requestType,
      "10 MAIN ST",
    );
    expect(firstFetch).toHaveBeenCalledOnce();
    expect(secondFetch).not.toHaveBeenCalled();
  });

  it("stores and serves complete negative answers as successes while force still calls", async () => {
    getConfig.mockResolvedValue({
      id: "cached-config",
      pluginKind: "wc-vendors",
      pluginId: "cached-contract-fixture",
      enabled: true,
      name: "Cached fixture",
      data: {},
    });
    const negative = { normalized: "" };
    cachedRun.mockResolvedValue({ answered: true, value: negative });

    await expect(wcRequest({
      vendor: { configId: "cached-config" },
      operation: "tests.cache.answer",
      args: { address: "missing" },
    })).resolves.toMatchObject({
      source: "network",
      outcome: "success",
      value: negative,
    });
    expect(cacheWriteSuccess).toHaveBeenCalledWith(
      "Census",
      "cached-config",
      "tests.cache.answer",
      "MISSING",
      negative,
    );
    expect(cacheWriteFailure).not.toHaveBeenCalled();

    cacheRead.mockResolvedValue({
      outcome: "success",
      response: negative,
      fetchedAt: new Date(),
    });
    cachedRun.mockClear();
    for (const mode of ["default", "cached-only"] as const) {
      await expect(wcRequest({
        vendor: { configId: "cached-config" },
        operation: "tests.cache.answer",
        args: { address: "missing" },
        mode,
      })).resolves.toMatchObject({
        source: "cache",
        outcome: "success",
        value: negative,
      });
    }
    expect(cachedRun).not.toHaveBeenCalled();

    await expect(wcRequest({
      vendor: { configId: "cached-config" },
      operation: "tests.cache.answer",
      args: { address: "missing" },
      mode: "force",
    })).resolves.toMatchObject({ source: "network", outcome: "success" });
    expect(cachedRun).toHaveBeenCalledOnce();
  });

  it("keeps incomplete and failed vendor attempts on the failure path", async () => {
    getConfig.mockResolvedValue({
      id: "cached-config",
      pluginKind: "wc-vendors",
      pluginId: "cached-contract-fixture",
      enabled: true,
      name: "Cached fixture",
      data: {},
    });
    cachedRun.mockResolvedValue({
      answered: false,
      value: { normalized: "LOCAL FALLBACK" },
      error: "Provider response was incomplete",
    });

    await expect(wcRequest({
      vendor: { configId: "cached-config" },
      operation: "tests.cache.answer",
      args: { address: "missing" },
    })).resolves.toMatchObject({
      source: "network",
      outcome: "failure",
      fallback: { normalized: "LOCAL FALLBACK" },
      error: "Provider response was incomplete",
    });
    expect(cacheWriteFailure).toHaveBeenCalledOnce();
    expect(cacheWriteSuccess).not.toHaveBeenCalled();
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
      operation: "tests.cache.answer",
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
        operation: "tests.cache.answer",
        args: { address: "11 main st" },
      }),
    ).rejects.toBeInstanceOf(MaintenanceModeError);
  });
});
