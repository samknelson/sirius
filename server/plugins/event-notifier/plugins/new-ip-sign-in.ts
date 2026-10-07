import { EventType, type SignInAfterPayload } from "../../../services/event-bus";
import { registerEventNotifier } from "../registry";
import { templatesSchemaBlock } from "../template-schema";
import type { EventNotifierEventContext, EventNotifierPlugin, NotifierChannelTemplates } from "../types";
import { normalizeSessionIp } from "../../../auth/session-ip";
import { isComponentEnabledSync } from "../../../services/component-cache";
import { suppliedSessionUserAgent } from "@shared/session-device";

const payloadOf = (ctx: EventNotifierEventContext) => ctx.payload as SignInAfterPayload;
const TITLE = "[{{system.site_name}}] New login detected";
const BODY = "We detected a login to your account from an IP address or browser we haven't seen in your recent session history. IP address: {{session.ip}}. Browser / User-Agent: {{session.user_agent}}. If this was you, no action is needed. Otherwise, contact your site administrator immediately.";

export function newIpSignInDefaultTemplates(): NotifierChannelTemplates {
  return {
    email: { subject: TITLE, bodyHtml: `<p>${BODY}</p>` },
    inapp: { title: TITLE, body: BODY },
    sms: { body: "{{system.site_name}}: New login detected from an unfamiliar IP or browser. IP: {{session.ip}}. User-Agent: {{session.user_agent}}. If this wasn't you, contact your administrator." },
  };
}

export const newIpSignInNotifier: EventNotifierPlugin = {
  id: "new-ip-sign-in",
  name: "New IP or Device Sign-in Notifier",
  description: "Notifies the signing-in account when its IP or browser identifier is new relative to retained session history. The first observed value of each is recorded silently.",
  requiredComponent: "system.session_history",
  notifySelf: true,
  subscribedEvents: [EventType.AUTH_SIGN_IN_AFTER],
  supportedMedia: ["inapp", "email", "sms"],
  configSchema: {
    type: "object",
    properties: { templates: templatesSchemaBlock({ exampleTokens: ["{{system.site_name}}", "{{session.ip}}", "{{session.user_agent}}"] }) },
  },
  tokenTemplates: {
    roots: [{
      name: "session", kind: "session", label: "Sign-in session",
      description: "The IP and supplied User-Agent captured when this account signed in",
      async build(ctx) {
        const payload = payloadOf(ctx);
        return { kind: "session", row: { ip: normalizeSessionIp(payload.ip), userAgent: suppliedSessionUserAgent(payload.userAgent) } };
      },
    }],
    defaultTemplates: newIpSignInDefaultTemplates,
  },
  shouldDispatch(ctx) {
    if (!isComponentEnabledSync("system.session_history")) return false;
    const payload = payloadOf(ctx);
    // This decision comes from the history storage's atomic comparison +
    // insertion, before the current observation exists. All configs receive
    // the same immutable answer, not a later contaminated table re-read.
    if (payload.ipDecision === "restored-session" || payload.deviceDecision === "restored-session") return false;
    return (payload.ipDecision === "new-ip" && !!normalizeSessionIp(payload.ip)) ||
      payload.deviceDecision === "new-device";
  },
  async getRecipients(ctx) {
    const { storage } = await import("../../../storage");
    const user = await storage.users.getUser(payloadOf(ctx).userId);
    if (!user?.isActive || !user.email) return [];
    const contact = await storage.contacts.getContactByEmail(user.email);
    return contact ? [{ contactId: contact.id, userId: user.id }] : [];
  },
  getSendKey(ctx) {
    return `new-ip-sign-in:${ctx.configId ?? "unconfigured"}:${payloadOf(ctx).occurrenceId}`;
  },
  async shouldSendToRecipient(medium, recipient) {
    if (medium !== "sms") return true;
    const { storage } = await import("../../../storage");
    const phones = await storage.contacts.phoneNumbers.getPhoneNumbersByContact(recipient.contactId);
    const active = phones.filter(phone => phone.isActive);
    const chosen = active.find(phone => phone.isPrimary) ?? active[0];
    if (!chosen) return false;
    const { parsePhoneNumberFromString } = await import("libphonenumber-js");
    const phone = parsePhoneNumberFromString(chosen.phoneNumber, "US");
    if (!phone?.isValid()) return false;
    const { createCommSmsOptinStorage } = await import("../../../storage/comm");
    const optin = await createCommSmsOptinStorage().getSmsOptinByPhoneNumber(phone.number);
    return optin?.optin === true;
  },
};

registerEventNotifier(newIpSignInNotifier);
