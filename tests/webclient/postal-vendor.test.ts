import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginConfig } from "@shared/schema";
import { storage } from "../../server/storage";
import { getWcVendorPlugin } from "../../server/plugins/wc-vendors";
import { wcRequest } from "../../server/services/webclient";
import {
  ensurePostalVendorConfig,
  postalSupportsOperation,
  setPostalVendor,
} from "../../server/services/comm/postal-vendor";
import * as postalVendor from "../../server/services/comm/postal-vendor";
import * as addressVerification from "../../server/services/comm/validators/address-verification";
import { sendPostal } from "../../server/services/comm/senders/postal";

function config(
  id: string,
  pluginId: string,
  enabled: boolean,
  data: Record<string, unknown> = {},
): PluginConfig {
  return {
    id,
    pluginKind: "wc-vendors",
    pluginId,
    enabled,
    name: pluginId,
    ordering: 0,
    data,
  } as PluginConfig;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("postal vendor safety", () => {
  it("does not expose delivery simulation operations for Local Postal", async () => {
    const plugin = getWcVendorPlugin("local-postal");
    expect(plugin).toBeDefined();
    expect(plugin?.operations["send-letter"]).toBeUndefined();
    expect(plugin?.operations["letter-status"]).toBeUndefined();
    expect(plugin?.operations["cancel-letter"]).toBeUndefined();

    await expect(
      wcRequest({
        vendor: { pluginId: "local-postal" },
        operation: "send-letter",
        args: {} as never,
      }),
    ).rejects.toThrow();
    expect(await postalSupportsOperation({ pluginId: "local-postal" }, "send-letter")).toBe(false);
    expect(await postalSupportsOperation({ pluginId: "local-postal" }, "verify-address")).toBe(true);
    expect(await postalSupportsOperation({ pluginId: "lob" }, "send-letter")).toBe(true);
  });

  it("does not let stale legacy Lob settings override an established Local Postal selection", async () => {
    const local = config("postal-local", "local-postal", true);
    const lob = config("postal-lob", "lob", false);
    vi.spyOn(storage.pluginConfigs, "getByKind").mockResolvedValue([local, lob]);
    vi.spyOn(storage.variables, "getByName").mockResolvedValue({
      value: {
        defaultProvider: "lob",
        providers: {
          lob: {
            settings: {
              defaultReturnAddress: { addressLine1: "1 Main St" },
            },
          },
        },
      },
    } as never);
    const update = vi.spyOn(storage.pluginConfigs, "update").mockImplementation(
      async (id, patch) => ({
        ...(id === lob.id ? lob : local),
        ...patch,
      } as PluginConfig),
    );
    vi.spyOn(storage.advisoryLock, "withTransactionLock").mockImplementation(
      async (_name, callback) => callback(),
    );

    const selected = await ensurePostalVendorConfig();

    expect(selected.id).toBe(local.id);
    expect(selected.pluginId).toBe("local-postal");
    expect(update).not.toHaveBeenCalled();
  });

  it("requires an enabled canonical wc-vendor row and ignores legacy settings", async () => {
    const lob = config("postal-lob", "lob", false);
    const local = config("postal-local", "local-postal", false);
    vi.spyOn(storage.pluginConfigs, "getByKind").mockResolvedValue([lob, local]);
    vi.spyOn(storage.variables, "getByName").mockResolvedValue({
      value: {
        defaultProvider: "lob",
        providers: {
          lob: {
            settings: {
              defaultReturnAddress: { addressLine1: "1 Main St" },
            },
          },
        },
      },
    } as never);
    const legacyRead = vi.spyOn(storage.variables, "getByName");
    vi.spyOn(storage.advisoryLock, "withTransactionLock").mockImplementation(
      async (_name, callback) => callback(),
    );

    await expect(ensurePostalVendorConfig()).rejects.toThrow(
      "No enabled postal wc-vendor configuration exists.",
    );
    expect(legacyRead).not.toHaveBeenCalled();
  });

  it("switches providers under the shared transaction lock", async () => {
    const local = config("postal-local", "local-postal", true);
    const lob = config("postal-lob", "lob", false);
    vi.spyOn(storage.pluginConfigs, "getByKind").mockResolvedValue([local, lob]);
    const update = vi.spyOn(storage.pluginConfigs, "update").mockImplementation(
      async (id, patch) => ({
        ...(id === lob.id ? lob : local),
        ...patch,
      } as PluginConfig),
    );
    const lock = vi.spyOn(storage.advisoryLock, "withTransactionLock").mockImplementation(
      async (_name, callback) => callback(),
    );

    const selected = await setPostalVendor("lob");

    expect(selected.id).toBe(lob.id);
    expect(lock).toHaveBeenCalledWith("wc-vendors:postal-selection", expect.any(Function));
    expect(update).toHaveBeenCalledWith(local.id, { enabled: false });
    expect(update).toHaveBeenCalledWith(lob.id, { enabled: true });
  });

  it("returns POSTAL_NOT_SUPPORTED before address validation or a send claim", async () => {
    vi.spyOn(postalVendor, "resolvePostalVendorTarget").mockResolvedValue({
      configId: "postal-local",
    });
    vi.spyOn(postalVendor, "postalSupportsOperation").mockResolvedValue(false);
    const verify = vi.spyOn(addressVerification, "verifyPostalAddress");

    const result = await sendPostal({
      contactId: "contact-without-a-claim",
      toAddress: {
        addressLine1: "not even an address",
        city: "",
        state: "",
        zip: "",
        country: "US",
      },
      sendKey: "must-not-be-spent",
    });

    expect(result).toMatchObject({
      success: false,
      errorCode: "POSTAL_NOT_SUPPORTED",
    });
    expect(verify).not.toHaveBeenCalled();
  });
});