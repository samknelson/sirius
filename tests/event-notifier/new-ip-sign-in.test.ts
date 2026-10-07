import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EventNotifierEventContext } from "../../server/plugins/event-notifier/types";

const fakes = vi.hoisted(() => ({
  enabled: vi.fn(() => true),
  user: vi.fn(),
  contact: vi.fn(),
  phones: vi.fn(),
  optin: vi.fn(),
}));
vi.mock("../../server/services/component-cache", () => ({ isComponentEnabledSync: fakes.enabled }));
vi.mock("../../server/logger", () => ({ logger: { warn: vi.fn(), debug: vi.fn(), error: vi.fn() } }));
vi.mock("../../server/storage", () => ({
  storage: {
    users: { getUser: fakes.user },
    contacts: { getContactByEmail: fakes.contact, phoneNumbers: { getPhoneNumbersByContact: fakes.phones } },
  },
}));
vi.mock("../../server/storage/comm", () => ({
  createCommSmsOptinStorage: () => ({ getSmsOptinByPhoneNumber: fakes.optin }),
}));

import { EventType } from "../../server/services/event-bus";
import { newIpSignInNotifier as plugin } from "../../server/plugins/event-notifier/plugins/new-ip-sign-in";
import { resolveTemplates, composeFromTemplates } from "../../server/plugins/event-notifier/token-templates";

const ctx: EventNotifierEventContext = {
  event: EventType.AUTH_SIGN_IN_AFTER, configId: "config-a",
  payload: { occurrenceId: "occurrence-a", userId: "account-a", ip: "192.0.2.10", occurredAt: "2026-10-07T12:00:00Z", ipDecision: "new-ip" },
};
const recipient = { contactId: "contact-a", userId: "account-a" };

beforeEach(() => {
  vi.clearAllMocks();
  fakes.enabled.mockReturnValue(true);
  fakes.user.mockResolvedValue({ id: "account-a", email: "account@example.invalid", isActive: true });
  fakes.contact.mockResolvedValue({ id: "contact-a" });
  fakes.phones.mockResolvedValue([{ phoneNumber: "+12025550123", isActive: true, isPrimary: true }]);
  fakes.optin.mockResolvedValue({ optin: true });
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
  it("captures only the immutable normalized IP, never a session credential", async () => {
    const root = await plugin.tokenTemplates!.roots[0].build(ctx);
    expect(root).toEqual({ kind: "session", row: { ip: "192.0.2.10" } });
  });
  it.each(["email", "inapp", "sms"] as const)("renders the default IP token through real %s delivery composition", async medium => {
    const root = await plugin.tokenTemplates!.roots[0].build(ctx);
    const result = await composeFromTemplates(plugin, medium, recipient,
      [{ name: "session", entity: root! }], resolveTemplates(plugin, {}), new Map());
    expect(result.blankRequired).toEqual([]);
    const content = JSON.stringify(result.content);
    expect(content).toContain("192.0.2.10");
    expect(content).not.toContain("{{");
    expect(content).not.toContain("unknown token");
    if (medium === "email") expect(result.content?.bodyText).toContain("192.0.2.10");
  });
});
