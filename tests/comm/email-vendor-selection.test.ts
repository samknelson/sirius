import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  configs: [] as any[],
  nextId: 1,
}));

vi.mock("../../server/storage", () => ({
  storage: {
    advisoryLock: {
      withTransactionLock: async (_name: string, fn: () => Promise<unknown>) => fn(),
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
beforeEach(() => {
  state.configs = [];
  state.nextId = 1;
});

describe("email vendor selection", () => {
  it("requires an enabled canonical wc-vendor row", async () => {
    await expect(ensureEmailVendorConfig()).rejects.toThrow(
      "No enabled email wc-vendor configuration exists.",
    );
    expect(state.configs).toHaveLength(0);
  });

  it("creates a canonical row from an explicit administrator selection", async () => {
    const selected = await setEmailVendor("sendgrid");

    expect(selected).toMatchObject({
      pluginKind: "wc-vendors",
      pluginId: "sendgrid",
      enabled: true,
      data: { secretName: "SENDGRID_API_KEY" },
    });
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