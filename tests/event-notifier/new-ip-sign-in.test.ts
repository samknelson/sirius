import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EventNotifierEventContext } from "../../server/plugins/event-notifier/types";

const fakes = vi.hoisted(() => ({
  enabled: vi.fn(() => true),
  user: vi.fn(),
  contact: vi.fn(),
  phones: vi.fn(),
  optin: vi.fn(),
  variable: vi.fn(),
}));
vi.mock("../../server/services/component-cache", () => ({ isComponentEnabledSync: fakes.enabled }));
vi.mock("../../server/logger", () => ({ logger: { warn: vi.fn(), debug: vi.fn(), error: vi.fn() } }));
vi.mock("../../server/storage", () => ({
  storage: {
    users: { getUser: fakes.user },
    variables: { getByName: fakes.variable },
    contacts: { getContactByEmail: fakes.contact, phoneNumbers: { getPhoneNumbersByContact: fakes.phones } },
  },
}));
vi.mock("../../server/storage/comm", () => ({
  createCommSmsOptinStorage: () => ({ getSmsOptinByPhoneNumber: fakes.optin }),
}));

import { EventType } from "../../server/services/event-bus";
import { newIpSignInNotifier as plugin } from "../../server/plugins/event-notifier/plugins/new-ip-sign-in";
import { resolveTemplates, composeFromTemplates } from "../../server/plugins/event-notifier/token-templates";
import { notifierTokenRootNames } from "../../server/plugins/event-notifier/token-roots";

const ctx: EventNotifierEventContext = {
  event: EventType.AUTH_SIGN_IN_AFTER, configId: "config-a",
  payload: { occurrenceId: "occurrence-a", userId: "account-a", ip: "192.0.2.10", occurredAt: "2026-10-07T12:00:00Z", ipDecision: "new-ip", deviceDecision: "known-device", userAgent: "Browser/1 (supplied)" },
};
const recipient = { contactId: "contact-a", userId: "account-a" };

beforeEach(() => {
  vi.clearAllMocks();
  fakes.enabled.mockReturnValue(true);
  fakes.user.mockResolvedValue({ id: "account-a", email: "account@example.invalid", isActive: true });
  fakes.contact.mockResolvedValue({ id: "contact-a" });
  fakes.phones.mockResolvedValue([{ phoneNumber: "+12025550123", isActive: true, isPrimary: true }]);
  fakes.optin.mockResolvedValue({ optin: true });
  fakes.variable.mockResolvedValue({ name: "site_name", value: "Example Site" });
});

describe("new IP sign-in notifier", () => {
  it("is component gated, explicitly permits self-notification and never offers postal", () => {
    expect(plugin.requiredComponent).toBe("system.session_history");
    expect(plugin.notifySelf).toBe(true);
    expect(plugin.supportedMedia).toEqual(["inapp", "email", "sms"]);
  });
  it.each(["baseline", "known-ip", "missing-ip", "restored-session", null])("skips %s", async (ipDecision) => {
    expect(await plugin.shouldDispatch!({ ...ctx, payload: { ...ctx.payload as object, ipDecision } }, {})).toBe(false);
  });
  it("dispatches only a genuine new IP and skips disabled or missing-IP events", async () => {
    expect(await plugin.shouldDispatch!(ctx, {})).toBe(true);
    expect(await plugin.shouldDispatch!({ ...ctx, payload: { ...ctx.payload as object, ip: null } }, {})).toBe(false);
    fakes.enabled.mockReturnValue(false);
    expect(await plugin.shouldDispatch!(ctx, {})).toBe(false);
  });
  it.each([
    { ipDecision: "known-ip", deviceDecision: "new-device", ip: "192.0.2.10", alert: true },
    { ipDecision: "new-ip", deviceDecision: "new-device", ip: "192.0.2.10", alert: true },
    { ipDecision: "missing-ip", deviceDecision: "new-device", ip: null, alert: true },
    { ipDecision: "baseline", deviceDecision: "new-device", ip: "192.0.2.10", alert: true },
    { ipDecision: "new-ip", deviceDecision: "baseline", ip: "192.0.2.10", alert: true },
    { ipDecision: "new-ip", deviceDecision: "missing-device", ip: "192.0.2.10", alert: true },
    { ipDecision: "known-ip", deviceDecision: "baseline", ip: "192.0.2.10", alert: false },
    { ipDecision: "baseline", deviceDecision: "baseline", ip: "192.0.2.10", alert: false },
    { ipDecision: "known-ip", deviceDecision: "known-device", ip: "192.0.2.10", alert: false },
    { ipDecision: "restored-session", deviceDecision: "new-device", ip: "192.0.2.10", alert: false },
    { ipDecision: "new-ip", deviceDecision: "restored-session", ip: "192.0.2.10", alert: false },
    { ipDecision: null, deviceDecision: null, ip: "192.0.2.10", alert: false },
  ])("dispatches correctly for $ipDecision / $deviceDecision", async scenario => {
    const event = { ...ctx, payload: { ...ctx.payload as object, ...scenario } };
    expect(await plugin.shouldDispatch!(event, {})).toBe(scenario.alert);
    fakes.enabled.mockReturnValue(false);
    expect(await plugin.shouldDispatch!(event, {})).toBe(false);
  });
  it("targets the actual sign-in account and its existing contact", async () => {
    expect(await plugin.getRecipients!(ctx)).toEqual([recipient]);
    expect(fakes.user).toHaveBeenCalledWith("account-a");
    fakes.contact.mockResolvedValue(undefined);
    expect(await plugin.getRecipients!(ctx)).toEqual([]);
  });
  it("provides occurrence/config-scoped keys rather than permanent user/IP keys", () => {
    expect(plugin.getSendKey!(ctx, recipient, "sms")).toBe(plugin.getSendKey!(ctx, recipient, "sms"));
    expect(plugin.getSendKey!({ ...ctx, configId: "config-b" }, recipient, "sms")).not.toBe(plugin.getSendKey!(ctx, recipient, "sms"));
    expect(plugin.getSendKey!({ ...ctx, payload: { ...ctx.payload as object, occurrenceId: "occurrence-b" } }, recipient, "sms"))
      .not.toBe(plugin.getSendKey!(ctx, recipient, "sms"));
  });
  it("filters SMS consent before composition or creating failed communication rows", async () => {
    expect(await plugin.shouldSendToRecipient!("sms", recipient, ctx)).toBe(true);
    fakes.optin.mockResolvedValue({ optin: false });
    expect(await plugin.shouldSendToRecipient!("sms", recipient, ctx)).toBe(false);
    expect(await plugin.shouldSendToRecipient!("email", recipient, ctx)).toBe(true);
    fakes.phones.mockResolvedValue([]);
    expect(await plugin.shouldSendToRecipient!("sms", recipient, ctx)).toBe(false);
  });
  it("captures only the normalized IP and descriptive User-Agent, never cookie identifiers", async () => {
    const root = await plugin.tokenTemplates!.roots[0].build({
      ...ctx, payload: { ...ctx.payload as object, deviceId: "synthetic-browser-uuid", sid: "synthetic-cookie" },
    });
    expect(root).toEqual({ kind: "session", row: { ip: "192.0.2.10", userAgent: "Browser/1 (supplied)" } });
    expect(notifierTokenRootNames(plugin.tokenTemplates!.roots)).toContain("system");
  });
  it.each(["email", "inapp", "sms"] as const)("renders the default IP token through real %s delivery composition", async medium => {
    const root = await plugin.tokenTemplates!.roots[0].build(ctx);
    const result = await composeFromTemplates(plugin, medium, recipient,
      [{ name: "session", entity: root! }], resolveTemplates(plugin, {}), new Map());
    expect(result.blankRequired).toEqual([]);
    const content = JSON.stringify(result.content);
    expect(content).toContain("192.0.2.10");
    expect(content).toContain("Browser/1 (supplied)");
    expect(content).toContain("Example Site");
    expect(content).not.toContain("{{");
    expect(content).not.toContain("unknown token");
    if (medium === "email") {
      expect(result.content?.subject).toBe("[Example Site] New login detected");
      expect(result.content?.bodyText).toContain("192.0.2.10");
      expect(result.content?.bodyText).toContain("Browser/1 (supplied)");
    }
    expect(fakes.variable).toHaveBeenCalledWith("site_name");
  });
  it("preserves customized templates while inherited defaults update", () => {
    const custom = resolveTemplates(plugin, { templates: {
      email: { subject: "Custom subject", bodyHtml: "<p>Custom body</p>" },
      sms: { body: "Custom SMS" },
    } });
    expect(custom.email).toMatchObject({ subject: "Custom subject", bodyHtml: "<p>Custom body</p>" });
    expect(custom.sms?.body).toBe("Custom SMS");
    expect(custom.inapp?.title).toBe("[{{system.site_name}}] New login detected");
  });
  it("previews sample session details with the real configured seedless site name", async () => {
    const { renderTokens, createTokenEvalContext } = await import("../../server/plugins/tokens");
    const { storage } = await import("../../server/storage");
    const preview = createTokenEvalContext(storage, undefined, { sample: true });
    const result = await renderTokens("{{session.ip}} / {{session.user_agent}} / {{system.site_name}}", preview, { strictUnknown: true });
    expect(result.unknownTokens).toEqual([]);
    expect(result.output).toContain("198.51.100.42");
    expect(result.output).toContain("ExampleBrowser/1.0");
    expect(result.output).toContain("Example Site");
    expect(result.output).not.toContain("Not supplied");
  });
  it("renders User-Agent as text, not executable HTML, in both email parts", async () => {
    const userAgent = 'Browser <img src=x onerror="alert(1)"> & supplied';
    const root = await plugin.tokenTemplates!.roots[0].build({
      ...ctx, payload: { ...ctx.payload as object, userAgent },
    });
    const result = await composeFromTemplates(plugin, "email", recipient,
      [{ name: "session", entity: root! }], resolveTemplates(plugin, {}), new Map());
    expect(result.content?.bodyHtml).not.toContain("<img");
    expect(result.content?.bodyHtml).toContain("&lt;img");
    expect(result.content?.bodyText).toContain(userAgent);
  });
  it.each(["email", "inapp", "sms"] as const)("missing descriptive fields do not prevent %s alerts", async medium => {
    const root = await plugin.tokenTemplates!.roots[0].build({
      ...ctx, payload: { ...ctx.payload as object, ip: null, userAgent: null, ipDecision: "missing-ip", deviceDecision: "new-device" },
    });
    const result = await composeFromTemplates(plugin, medium, recipient,
      [{ name: "session", entity: root! }], resolveTemplates(plugin, {}), new Map());
    expect(result.blankRequired).toEqual([]);
    expect(JSON.stringify(result.content)).toContain("Not supplied");
    expect(JSON.stringify(result.content)).not.toContain("{{");
  });
});
