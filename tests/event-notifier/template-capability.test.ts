import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  emailEnabled: true,
  smsEnabled: true,
  smsUnavailable: "unassigned",
  fail: false,
}));

vi.mock("../../server/services/webclient/wc-vendor-context", () => ({
  getWcVendorOperationAvailability: vi.fn(async (operation: string) => {
    if (state.fail) throw new Error("Storage unavailable");
    return operation === "communications.email.send"
      ? state.emailEnabled ? "available" : "unassigned"
      : state.smsEnabled ? "available" : state.smsUnavailable;
  }),
}));

import {
  getSiteEnabledTemplateChannels,
  getSiteTemplateChannelAvailability,
  hideUndeliverableTemplateChannels,
  templatesSchemaBlock,
} from "../../server/plugins/event-notifier/template-schema";

beforeEach(() => {
  state.emailEnabled = true;
  state.smsEnabled = true;
  state.smsUnavailable = "unassigned";
  state.fail = false;
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

  it.each([
    ["unassigned", "no enabled delivery provider is assigned"],
    ["ambiguous", "multiple enabled delivery providers are assigned"],
    ["component-disabled", "require disabled components"],
  ])("explains %s delivery without enabling editing or hiding unsupported-channel notices", async (status, message) => {
    state.smsEnabled = false;
    state.smsUnavailable = status;
    const availability = await getSiteTemplateChannelAvailability();
    expect(availability.enabled.has("sms")).toBe(false);
    expect(availability.reasons.sms).toContain(message);
    const schema = {
      type: "object",
      properties: {
        templates: templatesSchemaBlock({
          variants: [{ id: "removed", label: "Removal", channels: ["sms"] }],
        }),
      },
    };
    const original = structuredClone(schema);
    const decorated = hideUndeliverableTemplateChannels(schema, ["sms"], availability.enabled, availability.reasons) as typeof schema;
    const groups = decorated.properties.templates.properties as Record<string, Record<string, unknown>>;
    for (const key of ["sms", "removed_sms"]) {
      expect(groups[key]["x-token-hidden"]).toBe(true);
      expect(groups[key]["x-token-unavailable-reason"]).toBe(availability.reasons.sms);
      expect(groups[key].properties).toBeDefined(); // Keep stored overrides in the RJSF schema.
    }
    expect(groups.email["x-token-unavailable-reason"]).toBeUndefined();
    expect(groups.inapp["x-token-unavailable-reason"]).toBeUndefined();
    expect(schema).toEqual(original);
  });

  it("contains asynchronous capability failures and explains the failed check", async () => {
    state.fail = true;
    const availability = await getSiteTemplateChannelAvailability();
    expect(availability.enabled).toEqual(new Set(["inapp"]));
    expect(availability.reasons.sms).toContain("could not be checked");
    expect(availability.reasons.email).toContain("could not be checked");
  });
});