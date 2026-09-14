import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginConfig } from "@shared/schema";

const accountList = vi.hoisted(() => vi.fn());
const incomingPhoneNumberList = vi.hoisted(() => vi.fn());
const lookupFetch = vi.hoisted(() => vi.fn());
const twilioClient = vi.hoisted(() =>
  vi.fn(() => ({
    api: { accounts: { list: accountList } },
    incomingPhoneNumbers: { list: incomingPhoneNumberList },
    lookups: {
      v2: {
        phoneNumbers: vi.fn(() => ({ fetch: lookupFetch })),
      },
    },
  })),
);

vi.mock("twilio", () => ({ default: twilioClient }));

import { getWcVendorHandler } from "../../server/plugins/wc-vendors/registry";
import "../../server/plugins/wc-vendors/plugins/sms-twilio";

const context = {
  credential: { secretName: "TWILIO_TEST_SECRET", value: "test-token" },
  config: {
    id: "twilio-config",
    pluginKind: "wc-vendors",
    pluginId: "twilio",
    enabled: true,
    ordering: 0,
    data: {
      accountSid: "AC123",
      fromNumber: "+17025550100",
    },
  } as PluginConfig,
};

function handler(operation: string) {
  const found = getWcVendorHandler("twilio", operation as never);
  if (!found) throw new Error(`Missing twilio.${operation} test handler`);
  return found;
}

describe("Twilio manually runnable reads", () => {
  beforeEach(() => {
    accountList.mockReset();
    incomingPhoneNumberList.mockReset();
    lookupFetch.mockReset();
    twilioClient.mockClear();
  });

  it("keeps the phone-number listing capped at 50", async () => {
    incomingPhoneNumberList.mockResolvedValue([
      {
        sid: "PN123",
        phoneNumber: "+17025550100",
        friendlyName: "Dispatch",
        capabilities: { sms: true, voice: true, mms: false },
      },
    ]);

    await expect(
      handler("communications.phone.list")(context, {} as never),
    ).resolves.toEqual([
      {
        sid: "PN123",
        phoneNumber: "+17025550100",
        friendlyName: "Dispatch",
        capabilities: { sms: true, voice: true, mms: false },
      },
    ]);
    expect(incomingPhoneNumberList).toHaveBeenCalledWith({ limit: 50 });
  });

  it("passes a normalized phone number to the Twilio lookup", async () => {
    lookupFetch.mockResolvedValue({
      valid: true,
      phoneNumber: "+17025550100",
      countryCode: "US",
      lineTypeIntelligence: {
        type: "mobile",
        carrierName: "Example Mobile",
      },
    });

    await expect(
      handler("communications.phone.validate")(context, {
        phoneNumber: "(702) 555-0100",
      } as never),
    ).resolves.toMatchObject({
      answered: true,
      value: {
        valid: true,
        formatted: "+17025550100",
        smsPossible: true,
      },
    });
    expect(lookupFetch).toHaveBeenCalledWith({
      fields: "line_type_intelligence",
    });
  });
});