import { afterEach, describe, expect, it, vi } from "vitest";
import { getWcVendorPlugin } from "../../server/plugins/wc-vendors";
import { getWcVendorHandler } from "../../server/plugins/wc-vendors/registry";
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
    expect(plugin?.operations["communications.postal.send"]).toBeUndefined();
    expect(plugin?.operations["communications.postal.letter.status"]).toBeUndefined();
    expect(plugin?.operations["communications.postal.letter.cancel"]).toBeUndefined();

    await expect(
      wcRequest({
        vendor: { pluginId: "local-postal" },
        operation: "communications.postal.send",
        args: {} as never,
      }),
    ).rejects.toThrow();
    expect(plugin?.operations["communications.postal.address.verify"]).toBeDefined();
    expect(getWcVendorPlugin("lob")?.operations["communications.postal.send"]).toBeDefined();
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

  it("returns a completed invalid Lob verification as a cacheable answer", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({
        valid_address: false,
        deliverability: "undeliverable",
        components: {},
        deliverability_analysis: {},
      })),
    ));
    const handler = getWcVendorHandler(
      "lob",
      "communications.postal.address.verify",
    );
    if (!handler) throw new Error("Missing Lob address verification handler");

    const answer = await handler({
      credential: { secretName: "LOB_TEST_SECRET", value: "live_key" },
      config: {
        id: "lob-config",
        pluginKind: "wc-vendors",
        pluginId: "lob",
        enabled: true,
        ordering: 0,
        data: {},
      },
    } as never, {
      addressLine1: "1 Missing St",
      city: "Nowhere",
      state: "MA",
      zip: "00000",
      country: "US",
    } as never) as { answered: boolean; store?: boolean; value?: { valid?: boolean } };

    expect(answer).toMatchObject({ answered: true, value: { valid: false } });
    expect(answer.store).toBeUndefined();
  });

  it("keeps incomplete Lob responses on the failure path", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ deliverability: "undeliverable" })),
    ));
    const handler = getWcVendorHandler(
      "lob",
      "communications.postal.address.verify",
    );
    if (!handler) throw new Error("Missing Lob address verification handler");

    await expect(handler({
      credential: { secretName: "LOB_TEST_SECRET", value: "live_key" },
      config: {
        id: "lob-config",
        pluginKind: "wc-vendors",
        pluginId: "lob",
        enabled: true,
        ordering: 0,
        data: {},
      },
    } as never, {
      addressLine1: "1 Missing St",
      city: "Nowhere",
      state: "MA",
      zip: "00000",
      country: "US",
    } as never)).resolves.toMatchObject({
      answered: false,
      error: "Lob answered without a complete verification result",
    });
  });
});