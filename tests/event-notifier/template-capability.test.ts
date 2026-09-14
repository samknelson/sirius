import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  emailEnabled: true,
  smsEnabled: true,
}));

vi.mock("../../server/services/webclient/wc-vendor-context", () => ({
  hasWcVendorOperation: vi.fn(async (operation: string) =>
    operation === "send-email" ? state.emailEnabled : state.smsEnabled,
  ),
}));

import { getSiteEnabledTemplateChannels } from "../../server/plugins/event-notifier/template-schema";

beforeEach(() => {
  state.emailEnabled = true;
  state.smsEnabled = true;
});

describe("event notifier delivery capabilities", () => {
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