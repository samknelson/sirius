import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  configs: [] as any[],
  legacy: undefined as unknown,
  nextId: 1,
}));

vi.mock("../../server/storage", () => ({
  storage: {
    advisoryLock: {
      withTransactionLock: async (_name: string, fn: () => Promise<unknown>) => fn(),
    },
    variables: {
      getByName: async () =>
        state.legacy === undefined ? undefined : { value: state.legacy },
    },
    pluginConfigs: {
      getByKind: async () => state.configs,
      create: async (input: Record<string, unknown>) => {
        const row = { id: `email-config-${state.nextId++}`, ...input };
        state.configs.push(row);
        return row;
      },
      update: async (id: string, patch: Record<string, unknown>) => {
        const row = state.configs.find((entry) => entry.id === id);
        if (!row) return undefined;
        Object.assign(row, patch);
        return row;
      },
      upsertSubsidiary: async (_kind: string, row: { id: string }) => row,
    },
  },
}));

import {
  ensureEmailVendorConfig,
  setEmailVendor,
} from "../../server/services/comm/email-vendor";
import {
  LEGACY_LOCAL_EMAIL_PLUGIN_ID,
  LOCAL_EMAIL_PLUGIN_ID,
} from "../../server/plugins/wc-vendors/plugins/email";
import { setEnvironmentVariableOverrideSource } from "../../server/config/env-registry";

beforeEach(() => {
  state.configs = [];
  state.legacy = undefined;
  state.nextId = 1;
});

const environmentSnapshot = {
  apiKey: process.env.SENDGRID_API_KEY,
  fromEmail: process.env.SENDGRID_FROM_EMAIL,
  fromName: process.env.SENDGRID_FROM_NAME,
};

afterEach(() => {
  for (const [name, value] of [
    ["SENDGRID_API_KEY", environmentSnapshot.apiKey],
    ["SENDGRID_FROM_EMAIL", environmentSnapshot.fromEmail],
    ["SENDGRID_FROM_NAME", environmentSnapshot.fromName],
  ] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  setEnvironmentVariableOverrideSource(null);
});

describe("email vendor upgrade and selection", () => {
  it("migrates legacy local settings once and preserves the old provider id", async () => {
    state.legacy = {
      defaultProvider: LEGACY_LOCAL_EMAIL_PLUGIN_ID,
      providers: {
        [LEGACY_LOCAL_EMAIL_PLUGIN_ID]: {
          settings: {
            defaultFromEmail: "legacy@example.test",
            defaultFromName: "Legacy Sender",
          },
        },
      },
    };

    const first = await ensureEmailVendorConfig();
    const second = await ensureEmailVendorConfig();

    expect(first.id).toBe(second.id);
    expect(state.configs).toHaveLength(1);
    expect(first.pluginId).toBe(LOCAL_EMAIL_PLUGIN_ID);
    expect(first.data).toMatchObject({
      defaultFromEmail: "legacy@example.test",
      defaultFromName: "Legacy Sender",
    });
  });

  it("migrates an environment-only SendGrid installation by presence, never by copying the key", async () => {
    process.env.SENDGRID_API_KEY = "do-not-copy-this-value";
    process.env.SENDGRID_FROM_EMAIL = "env-sender@example.test";
    process.env.SENDGRID_FROM_NAME = "Environment Sender";

    const selected = await ensureEmailVendorConfig();

    expect(selected.pluginId).toBe("sendgrid");
    expect(selected.data).toMatchObject({
      secretName: "SENDGRID_API_KEY",
      defaultFromEmail: "env-sender@example.test",
      defaultFromName: "Environment Sender",
    });
    expect(JSON.stringify(selected.data)).not.toContain("do-not-copy-this-value");
  });

  it("detects SendGrid from an effective in-app env override without persisting its value", async () => {
    delete process.env.SENDGRID_API_KEY;
    setEnvironmentVariableOverrideSource((name) =>
      name === "SENDGRID_API_KEY" ? "override-key-do-not-copy" : undefined,
    );

    const selected = await ensureEmailVendorConfig();

    expect(selected.pluginId).toBe("sendgrid");
    expect(selected.data).toMatchObject({ secretName: "SENDGRID_API_KEY" });
    expect(JSON.stringify(selected.data)).not.toContain("override-key-do-not-copy");
  });

  it("fails explicitly instead of choosing between multiple enabled configs", async () => {
    state.configs = [
      { id: "email-a", pluginKind: "wc-vendors", pluginId: "local", enabled: true },
      { id: "email-b", pluginKind: "wc-vendors", pluginId: "sendgrid", enabled: true },
    ];

    await expect(ensureEmailVendorConfig()).rejects.toThrow(
      /email-a, email-b.*select a target config ID/i,
    );
  });

  it("uses an explicit target to repair multiple enabled legacy rows", async () => {
    state.configs = [
      { id: "email-a", pluginKind: "wc-vendors", pluginId: "local", enabled: true },
      { id: "email-b", pluginKind: "wc-vendors", pluginId: "sendgrid", enabled: true },
    ];

    const selected = await setEmailVendor("local", "email-a");

    expect(selected.id).toBe("email-a");
    expect(state.configs).toMatchObject([
      { id: "email-a", enabled: true },
      { id: "email-b", enabled: false },
    ]);
  });

  it("switches by an explicit config id and rejects a provider/id mismatch", async () => {
    state.configs = [
      { id: "email-local", pluginKind: "wc-vendors", pluginId: "local", enabled: true },
      { id: "email-sendgrid", pluginKind: "wc-vendors", pluginId: "sendgrid", enabled: false },
    ];

    const selected = await setEmailVendor("sendgrid", "email-sendgrid");
    expect(selected.id).toBe("email-sendgrid");
    expect(state.configs).toMatchObject([
      { id: "email-local", enabled: false },
      { id: "email-sendgrid", enabled: true },
    ]);

    await expect(
      setEmailVendor("sendgrid", "email-local"),
    ).rejects.toThrow(/email-local.*local.*not requested provider.*sendgrid/i);
  });

  it("switches Local to SendGrid with a named-secret reference instead of empty data", async () => {
    state.configs = [
      {
        id: "email-local",
        pluginKind: "wc-vendors",
        pluginId: "local",
        enabled: true,
        data: { defaultFromEmail: "local@example.test" },
      },
    ];

    const selected = await setEmailVendor("sendgrid");

    expect(selected.pluginId).toBe("sendgrid");
    expect(selected.data).toMatchObject({ secretName: "SENDGRID_API_KEY" });
    expect(selected.data).not.toHaveProperty("apiKey");
    expect(state.configs).toMatchObject([
      { id: "email-local", enabled: false },
      {
        pluginId: "sendgrid",
        enabled: true,
        data: { secretName: "SENDGRID_API_KEY" },
      },
    ]);
  });
});