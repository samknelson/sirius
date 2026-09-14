import { afterEach, describe, expect, it, vi } from "vitest";
import { getWcVendorPlugin } from "../../server/plugins/wc-vendors";
import { wcRequest } from "../../server/services/webclient";
import * as wcVendorContext from "../../server/services/webclient/wc-vendor-context";
import * as addressVerification from "../../server/services/comm/validators/address-verification";
import { sendPostal } from "../../server/services/comm/senders/postal";

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
    expect(plugin?.operations["verify-address"]).toBeDefined();
    expect(getWcVendorPlugin("lob")?.operations["send-letter"]).toBeDefined();
  });

  it("returns POSTAL_NOT_SUPPORTED before address validation or a send claim", async () => {
    vi.spyOn(wcVendorContext, "hasWcVendorOperation").mockResolvedValue(false);
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