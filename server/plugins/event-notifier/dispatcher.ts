import { eventBus, EventType } from "../../services/event-bus";
import { logger } from "../../logger";
import { isComponentEnabledSync } from "../../services/component-cache";
import { eventNotifierRegistry } from "./registry";
import {
  type EventNotifierEventContext,
  type NotificationMedium,
  type NotifierMessageContent,
  type NotifierRecipient,
} from "./types";

const SERVICE = "event-notifier-dispatcher";

/**
 * Resolve the destination + send for a single (recipient, medium) pair using
 * the message content the plugin composed. Each medium resolves its own
 * destination (email address, phone, in-app user, postal address) off the
 * recipient's contact and skips silently when the contact has nothing on file.
 * All sends are fire-and-forget: failures are logged, never thrown, so one bad
 * medium can't abort the rest of the fan-out.
 */
async function deliver(
  medium: NotificationMedium,
  recipient: NotifierRecipient,
  content: NotifierMessageContent,
  pluginId: string,
): Promise<void> {
  const { storage } = await import("../../storage");
  try {
    if (medium === "email") {
      if (!content.subject) return;
      const contact = await storage.contacts.getContact(recipient.contactId);
      if (!contact?.email) return;
      const { sendEmail } = await import("../../services/comm/senders/email");
      await sendEmail({
        contactId: recipient.contactId,
        toEmail: contact.email,
        subject: content.subject,
        bodyText: content.bodyText,
        bodyHtml: content.bodyHtml,
        userId: recipient.userId ?? undefined,
      });
      return;
    }

    if (medium === "sms") {
      if (!content.message) return;
      const phones = await storage.contacts.phoneNumbers.getPhoneNumbersByContact(
        recipient.contactId,
      );
      const active = phones.filter((p) => p.isActive);
      const chosen = active.find((p) => p.isPrimary) ?? active[0];
      if (!chosen) return;
      const { sendSms } = await import("../../services/comm/senders/sms");
      await sendSms({
        contactId: recipient.contactId,
        toPhoneNumber: chosen.phoneNumber,
        message: content.message,
        userId: recipient.userId ?? undefined,
      });
      return;
    }

    if (medium === "inapp") {
      if (!content.title || !content.body) return;
      // In-app messages must target an authenticated user. Prefer the userId the
      // plugin resolved; otherwise resolve it from the contact's email.
      let userId = recipient.userId ?? undefined;
      if (!userId) {
        const contact = await storage.contacts.getContact(recipient.contactId);
        if (contact?.email) {
          const user = await storage.users.getUserByEmail(contact.email);
          userId = user?.id;
        }
      }
      if (!userId) return;
      const { sendInapp } = await import("../../services/comm/senders/inapp");
      await sendInapp({
        contactId: recipient.contactId,
        userId,
        title: content.title,
        body: content.body,
        linkUrl: content.linkUrl,
        linkLabel: content.linkLabel,
        initiatedBy: SERVICE,
      });
      return;
    }

    if (medium === "postal") {
      if (!content.file && !content.templateId) return;
      const addresses = await storage.contacts.addresses.getContactPostalByContact(
        recipient.contactId,
      );
      const active = addresses.filter((a) => a.isActive);
      const chosen = active.find((a) => a.isPrimary) ?? active[0];
      if (!chosen) return;
      const { sendPostal } = await import("../../services/comm/senders/postal");
      await sendPostal({
        contactId: recipient.contactId,
        toAddress: {
          addressLine1: chosen.street,
          city: chosen.city,
          state: chosen.state,
          zip: chosen.postalCode,
          country: chosen.country,
        },
        file: content.file,
        templateId: content.templateId,
        description: content.description,
        mergeVariables: content.mergeVariables,
        userId: recipient.userId ?? undefined,
      });
      return;
    }
  } catch (error) {
    logger.warn(`Event-notifier send failed (${medium})`, {
      service: SERVICE,
      pluginId,
      medium,
      contactId: recipient.contactId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Handle one fired event for one enabled config: resolve the active media (the
 * admin's selection intersected with the plugin's supportedMedia), fetch the
 * recipients, then deliver each (recipient, medium) message the plugin composes.
 */
async function dispatchForConfig(
  pluginId: string,
  mediaSelection: NotificationMedium[],
  ctx: EventNotifierEventContext,
): Promise<void> {
  const plugin = eventNotifierRegistry.get(pluginId);
  if (!plugin) return;
  if (!plugin.subscribedEvents.includes(ctx.event)) return;
  if (
    plugin.requiredComponent &&
    !isComponentEnabledSync(plugin.requiredComponent)
  ) {
    return;
  }

  // Active media = admin selection ∩ what the plugin can actually produce.
  const supported = new Set(plugin.supportedMedia);
  const active = mediaSelection.filter((m) => supported.has(m));
  if (active.length === 0) return;

  const recipients = await plugin.getRecipients(ctx);
  if (recipients.length === 0) return;

  for (const recipient of recipients) {
    for (const medium of active) {
      const content = await plugin.getMessage(medium, recipient, ctx);
      if (!content) continue;
      await deliver(medium, recipient, content, pluginId);
    }
  }
}

function parseMedia(value: unknown): NotificationMedium[] {
  if (typeof value !== "string" || value.length === 0) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean) as NotificationMedium[];
}

/** Build the handler that fans a single fired event out to every enabled config. */
function makeHandler(event: EventType) {
  return async (payload: unknown): Promise<void> => {
    const { storage } = await import("../../storage");
    const ctx: EventNotifierEventContext = { event, payload };
    const envelopes = await storage.pluginConfigs.search("event-notifier");
    for (const envelope of envelopes) {
      if (!envelope.config.enabled) continue;
      const subsidiary = envelope.subsidiary as { media?: string | null } | null;
      const media = parseMedia(subsidiary?.media);
      if (media.length === 0) continue;
      try {
        await dispatchForConfig(envelope.config.pluginId, media, ctx);
      } catch (error) {
        logger.error("Event-notifier dispatch failed for config", {
          service: SERVICE,
          configId: envelope.config.id,
          pluginId: envelope.config.pluginId,
          event,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  };
}

let initialized = false;

/**
 * Subscribe the event-notifier framework to the event bus. Registers one bus
 * handler per distinct event any registered plugin subscribes to; each handler
 * fans the fired event out to every enabled config of a plugin that subscribes
 * to it. Call once at boot AFTER the plugin system is initialized (so the
 * registry is populated) — re-running is a no-op.
 */
export function initializeEventNotifierDispatcher(): void {
  if (initialized) return;

  const events = new Set<EventType>();
  for (const id of eventNotifierRegistry.listIds()) {
    const plugin = eventNotifierRegistry.get(id);
    plugin?.subscribedEvents.forEach((e) => events.add(e));
  }

  for (const event of Array.from(events)) {
    eventBus.on({
      name: `event-notifier:${event}`,
      description: `Fan out ${event} to enabled event-notifier configs.`,
      event,
      handler: makeHandler(event),
    });
  }

  initialized = true;
  logger.info("Event-notifier dispatcher initialized", {
    service: SERVICE,
    events: Array.from(events),
  });
}
