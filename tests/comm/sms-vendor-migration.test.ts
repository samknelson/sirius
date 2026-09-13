import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  configs: [] as any[],
  legacyValue: undefined as unknown,
  env: {
    TWILIO_ACCOUNT_SID: "AC_legacy_sid",
    TWILIO_PHONE_NUMBER: "+15551234567",
  } as Record<string, string>,
}));

const getEnvironmentVariable = vi.hoisted(() =>
  vi.fn((name: string) => {
    if (name === "TWILIO_AUTH_TOKEN") {
      throw new Error("auth token must not be read during migration");
    }
    return state.env[name];
  }),
);

vi.mock("../../server/config/env-registry", () => ({
  getEnvironmentVariable,
  registerEnvironmentVariables: vi.fn(),
}));

vi.mock("../../server/storage", () => ({
  storage: {
    variables: {
      getByName: vi.fn(async () =>
        state.legacyValue === undefined ? undefined : { value: state.legacyValue },
      ),
    },
    pluginConfigs: {
      getByKind: vi.fn(async () => state.configs),
      getByKindAndPlugin: vi.fn(async (_kind: string, pluginId: string) =>
        state.configs.filter((config) => config.pluginId === pluginId),
      ),
      create: vi.fn(async (input: any) => {
        const row = {
          id: `sms-${state.configs.length + 1}`,
          ...input,
        };
        state.configs.push(row);
        return row;
      }),
      update: vi.fn(async (id: string, input: any) => {
        const row = state.configs.find((config) => config.id === id);
        if (!row) return undefined;
        Object.assign(row, input);
        return row;
      }),
      upsertSubsidiary: vi.fn(async () => null),
    },
  },
}));

vi.mock("../../server/storage/transaction-context", () => ({
  runInTransaction: async <T>(fn: () => Promise<T>) => fn(),
  getClient: () => ({
    execute: vi.fn(async () => undefined),
  }),
}));

vi.mock("../../server/middleware/request-context", () => ({
  withFrameworkWrite: async <T>(fn: () => Promise<T>) => fn(),
}));

describe("SMS wc-vendor migration", () => {
  beforeEach(() => {
    state.configs.length = 0;
    state.legacyValue = undefined;
    state.env = {
      TWILIO_ACCOUNT_SID: "AC_legacy_sid",
      TWILIO_PHONE_NUMBER: "+15551234567",
    };
    getEnvironmentVariable.mockClear();
  });

  it("migrates environment-only Twilio credentials without reading the auth token", async () => {
    const { ensureSmsVendorConfig } = await import("../../server/services/comm/sms-vendor");

    const selected = await ensureSmsVendorConfig();
    const twilio = state.configs.find((config) => config.pluginId === "twilio");
    const local = state.configs.find((config) => config.pluginId === "sms-local");

    expect(selected.pluginId).toBe("twilio");
    expect(twilio).toMatchObject({
      enabled: true,
      data: {
        accountSid: "AC_legacy_sid",
        fromNumber: "+15551234567",
        secretName: "TWILIO_AUTH_TOKEN",
      },
    });
    expect(local.enabled).toBe(false);
    expect(getEnvironmentVariable).not.toHaveBeenCalledWith("TWILIO_AUTH_TOKEN");
  });

  it("preserves the legacy selected provider and exact defaultFromNumber", async () => {
    state.env = {};
    state.legacyValue = {
      defaultProvider: "local",
      providers: {
        local: {
          settings: {
            phoneValidation: { defaultCountry: "CA" },
          },
        },
        twilio: {
          settings: {
            accountSid: "AC_from_legacy",
            defaultFromNumber: "+15550001111",
            phoneValidation: { revalidateAfterDays: 9 },
          },
        },
      },
    };
    const { ensureSmsVendorConfig } = await import("../../server/services/comm/sms-vendor");

    const selected = await ensureSmsVendorConfig();
    const twilio = state.configs.find((config) => config.pluginId === "twilio");

    expect(selected.pluginId).toBe("sms-local");
    expect(twilio).toMatchObject({
      enabled: false,
      data: {
        accountSid: "AC_from_legacy",
        fromNumber: "+15550001111",
        secretName: "TWILIO_AUTH_TOKEN",
        phoneValidation: { revalidateAfterDays: 9 },
      },
    });
    expect(getEnvironmentVariable).not.toHaveBeenCalledWith("TWILIO_AUTH_TOKEN");
  });

  it("merges stored Twilio settings with environment SID and phone defaults", async () => {
    state.legacyValue = {
      defaultProvider: "twilio",
      providers: {
        twilio: {
          settings: {
            accountSid: "AC_stored_sid",
            defaultFromNumber: "+15550009999",
          },
        },
      },
    };
    state.env = {
      TWILIO_ACCOUNT_SID: "AC_environment_sid",
      TWILIO_PHONE_NUMBER: "+15550008888",
    };
    const { ensureSmsVendorConfig } = await import("../../server/services/comm/sms-vendor");

    const selected = await ensureSmsVendorConfig();
    const twilio = state.configs.find((config) => config.pluginId === "twilio");

    expect(selected.pluginId).toBe("twilio");
    expect(twilio.data).toMatchObject({
      accountSid: "AC_stored_sid",
      fromNumber: "+15550009999",
      secretName: "TWILIO_AUTH_TOKEN",
    });
    expect(twilio.data).not.toHaveProperty("authToken");
    expect(getEnvironmentVariable).not.toHaveBeenCalledWith("TWILIO_AUTH_TOKEN");
  });

  it("repairs an enabled incomplete Twilio row from effective environment values", async () => {
    state.env = {
      TWILIO_ACCOUNT_SID: "AC_repair_sid",
      TWILIO_PHONE_NUMBER: "+15550007777",
    };
    state.configs.push({
      id: "existing-twilio",
      pluginId: "twilio",
      pluginKind: "wc-vendors",
      enabled: true,
      data: { secretName: "TWILIO_AUTH_TOKEN" },
    });
    const { ensureSmsVendorConfig } = await import("../../server/services/comm/sms-vendor");

    const selected = await ensureSmsVendorConfig();

    expect(selected.data).toMatchObject({
      accountSid: "AC_repair_sid",
      fromNumber: "+15550007777",
      secretName: "TWILIO_AUTH_TOKEN",
    });
    expect(state.configs).toHaveLength(1);
  });

  it("does not disable Local when selecting missing Twilio without required environment values", async () => {
    state.env = {};
    state.configs.push({
      id: "existing-local",
      pluginId: "sms-local",
      pluginKind: "wc-vendors",
      enabled: true,
      data: {},
    });
    const { ensureSmsVendorTarget, SmsVendorConfigurationError } = await import(
      "../../server/services/comm/sms-vendor"
    );

    await expect(ensureSmsVendorTarget("twilio")).rejects.toBeInstanceOf(
      SmsVendorConfigurationError,
    );
    expect(state.configs).toHaveLength(1);
    expect(state.configs[0].enabled).toBe(true);
  });

  it("creates a valid Local target when it is the requested missing target", async () => {
    state.configs.push({
      id: "existing-twilio",
      pluginId: "twilio",
      pluginKind: "wc-vendors",
      enabled: true,
      data: {
        accountSid: "AC_existing",
        fromNumber: "+15550006666",
        secretName: "TWILIO_AUTH_TOKEN",
      },
    });
    const { ensureSmsVendorTarget } = await import(
      "../../server/services/comm/sms-vendor"
    );

    const local = await ensureSmsVendorTarget("sms-local");

    expect(local.pluginId).toBe("sms-local");
    expect(local.enabled).toBe(false);
    expect(local.data).toEqual({});
    expect(state.configs).toHaveLength(2);
  });
});