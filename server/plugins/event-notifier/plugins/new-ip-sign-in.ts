import { EventType, type SignInAfterPayload } from "../../../services/event-bus";
import { registerEventNotifier } from "../registry";
import { templatesSchemaBlock } from "../template-schema";
import type { EventNotifierEventContext, EventNotifierPlugin, NotifierChannelTemplates } from "../types";
import { normalizeSessionIp } from "../../../auth/session-ip";
import { isComponentEnabledSync } from "../../../services/component-cache";

const payloadOf = (ctx: EventNotifierEventContext) => ctx.payload as SignInAfterPayload;
const TITLE = "Sign-in from a new IP address";
const BODY = "Your account was signed in from IP address {{session.ip}}, which we haven't seen in your recent session history. If this was you, no action is needed. Otherwise, contact your site administrator immediately.";

export function newIpSignInDefaultTemplates(): NotifierChannelTemplates {
  return {
    email: { subject: TITLE, bodyHtml: `<p>${BODY}</p>` },
    inapp: { title: TITLE, body: BODY },
    sms: { body: "New sign-in from IP {{session.ip}}. If this wasn't you, contact your administrator immediately." },
  };
}

export const newIpSignInNotifier: EventNotifierPlugin = {
  id: "new-ip-sign-in",
  name: "New IP Sign-in Notifier",
  description: "Notifies the signing-in account when its IP is absent from its retained session history. The first observed IP is recorded silently.",
  requiredComponent: "system.session_history",
  notifySelf: true,
  subscribedEvents: [EventType.AUTH_SIGN_IN_AFTER],
  supportedMedia: ["inapp", "email", "sms"],
  configSchema: {
    type: "object",
    properties: { templates: templatesSchemaBlock({ exampleTokens: ["{{session.ip}}"] }) },
  },
  tokenTemplates: {
    roots: [{
      name: "session", kind: "session", label: "Sign-in session",
      description: "The IP captured when this account signed in",
      async build(ctx) {
        const payload = payloadOf(ctx);
        return { kind: "session", row: { ip: normalizeSessionIp(payload.ip) } };
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
    return payload.ipDecision === "new-ip" && !!normalizeSessionIp(payload.ip);
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
