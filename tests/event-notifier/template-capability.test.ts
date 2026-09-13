import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  emailPluginId: "sendgrid",
  smsPluginId: "twilio",
}));

vi.mock("../../server/services/comm/email-vendor", () => ({
  ensureEmailVendorConfig: vi.fn(async () => ({ pluginId: state.emailPluginId })),
}));

vi.mock("../../server/services/comm/sms-vendor", () => ({
  ensureSmsVendorConfig: vi.fn(async () => ({ pluginId: state.smsPluginId })),
}));

vi.mock("../../server/plugins/wc-vendors", () => ({
  getWcVendorPlugin: (pluginId: string) => {
    if (pluginId === "sendgrid") {
      return { operations: { "send-email": { description: "send email" } } };
    }
    if (pluginId === "twilio") {
      return { operations: { "send-sms": { description: "send SMS" } } };
    }
    if (pluginId === "local-email") {
      return { operations: { "validate-email": { description: "validate email" } } };
    }
    if (pluginId === "sms-local") {
      return { operations: { "validate-phone": { description: "validate phone" } } };
    }
    return undefined;
  },
}));

import { getSiteEnabledTemplateChannels } from "../../server/plugins/event-notifier/template-schema";

beforeEach(() => {
  state.emailPluginId = "sendgrid";
  state.smsPluginId = "twilio";
});

describe("event notifier delivery capabilities", () => {
  it("advertises configured SendGrid and Twilio delivery channels", async () => {
    await expect(getSiteEnabledTemplateChannels()).resolves.toEqual(
      new Set(["inapp", "email", "sms"]),
    );
  });

  it("does not advertise delivery for local validation-only vendors", async () => {
    state.emailPluginId = "local-email";
    state.smsPluginId = "sms-local";

    await expect(getSiteEnabledTemplateChannels()).resolves.toEqual(
      new Set(["inapp"]),
    );
  });
});