import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  emailEnabled: true,
  smsEnabled: true,
  postalEnabled: false,
}));

vi.mock("../../server/services/webclient/wc-vendor-context", () => ({
  hasWcVendorOperation: vi.fn(async (operation: string) =>
    operation === "communications.email.send" ? state.emailEnabled :
      operation === "communications.postal.send" ? state.postalEnabled : state.smsEnabled,
  ),
}));

import { getSiteEnabledTemplateChannels } from "../../server/plugins/event-notifier/template-schema";

beforeEach(() => {
  state.emailEnabled = true;
  state.smsEnabled = true;
  state.postalEnabled = false;
});

describe("event notifier delivery capabilities", () => {
  it("retains postal as a delivery channel when a postal sending connection is assigned", async () => {
    state.postalEnabled = true;
    await expect(getSiteEnabledTemplateChannels()).resolves.toEqual(
      new Set(["inapp", "email", "postal", "sms"]),
    );
  });
  it("advertises configured SendGrid and Twilio delivery channels", async () => {
    await expect(getSiteEnabledTemplateChannels()).resolves.toEqual(
      new Set(["inapp", "email", "sms"]),
    );
  });

  it("does not advertise delivery for local validation-only vendors", async () => {
    state.emailEnabled = false;
    state.smsEnabled = false;

    await expect(getSiteEnabledTemplateChannels()).resolves.toEqual(
      new Set(["inapp"]),
    );
  });
});