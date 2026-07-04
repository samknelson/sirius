import { eventBus, EventType } from "../../services/event-bus";
import { logger } from "../../logger";
import { isPluginComponentEnabledSync } from "../_core";
import { eventNotifierRegistry } from "./registry";
import { getEnabledConfigsForKind } from "../_core/plugin-config-cache";
import { checkFlood, recordFloodEvent } from "../../flood/service";
import { NOTIFICATION_FLOOD_EVENTS } from "../../flood/events";
import {
  type EventNotifierEventContext,
  type NotificationMedium,
  type NotifierMessageContent,
  type NotifierRecipient,
} from "./types";
import {
  areNotificationsSuppressed,
  getRequestContext,
} from "../../middleware/request-context";
import { recordSentNotification } from "./flash-summary";

const SERVICE = "event-notifier-dispatcher";

/**
 * Flood gate for a single (recipient, medium, plugin) send. Counts prior sends
 * in the medium's rolling window and, if under the admin-configured limit,
 * records this send and returns true. If over the limit, logs and returns false
 * so the caller skips just this one send. Fails OPEN: if the check itself errors
 * (e.g. a transient DB hiccup) the send proceeds, so throttling infrastructure
 * can never silently swallow legitimate notifications. Must be called only once
 * we know the send is actually deliverable, so no-op sends don't consume budget.
 */
async function passesNotificationFlood(
  medium: NotificationMedium,
  contactId: string,
  pluginId: string,
): Promise<boolean> {
  const eventName = NOTIFICATION_FLOOD_EVENTS[medium];
  if (!eventName) return true;
  try {
    const result = await checkFlood(eventName, { contactId, pluginId });
    if (!result.allowed) {
      logger.warn("Event-notifier send throttled by flood limit", {
        service: SERVICE,
        pluginId,
        medium,
        contactId,
        count: result.count,
        threshold: result.threshold,
        windowSeconds: result.windowSeconds,
      });
      return false;
    }
    await recordFloodEvent(eventName, { contactId, pluginId });
    return true;
  } catch (error) {
    logger.warn("Event-notifier flood check failed; sending anyway (fail open)", {
      service: SERVICE,
      pluginId,
      medium,
      contactId,
      error: error instanceof Error ? error.message : String(error),
    });
    return true;
  }
}

/**
 * Resolve the destination + send for a single (recipient, medium) pair using
 * the message content the plugin composed. Each medium resolves its own
 * destination (email address, phone, in-app user, postal address) off the
 * recipient's contact and skips silently when the contact has nothing on file.
 * All sends are fire-and-forget: failures are logged, never thrown, so one bad
 * medium can't abort the rest of the fan-out. Returns true only when a message
 * was actually handed off to the send layer, so the caller can tally successful
 * deliveries; every silent skip (no destination on file, throttled, missing
 * content) and every caught failure returns false.
 */
async function deliver(
  medium: NotificationMedium,
  recipient: NotifierRecipient,
  content: NotifierMessageContent,
  pluginId: string,
  tagIds: string[],
): Promise<boolean> {
  const { storage } = await import("../../storage");
  try {
    if (medium === "email") {
      if (!content.subject) return false;
      const contact = await storage.contacts.getContact(recipient.contactId);
      if (!contact?.email) return false;
      if (!(await passesNotificationFlood(medium, recipient.contactId, pluginId))) return false;
      const { sendEmail } = await import("../../services/comm/senders/email");
      await sendEmail({
        contactId: recipient.contactId,
        toEmail: contact.email,
        subject: content.subject,
        bodyText: content.bodyText,
        bodyHtml: content.bodyHtml,
        userId: recipient.userId ?? undefined,
        tagIds,
      });
      return true;
    }

    if (medium === "sms") {
      if (!content.message) return false;
      const phones = await storage.contacts.phoneNumbers.getPhoneNumbersByContact(
        recipient.contactId,
      );
      const active = phones.filter((p) => p.isActive);
      const chosen = active.find((p) => p.isPrimary) ?? active[0];
      if (!chosen) return false;
      if (!(await passesNotificationFlood(medium, recipient.contactId, pluginId))) return false;
      const { sendSms } = await import("../../services/comm/senders/sms");
      await sendSms({
        contactId: recipient.contactId,
        toPhoneNumber: chosen.phoneNumber,
        message: content.message,
        userId: recipient.userId ?? undefined,
        tagIds,
      });
      return true;
    }

    if (medium === "inapp") {
      if (!content.title || !content.body) return false;
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
      if (!userId) return false;
      if (!(await passesNotificationFlood(medium, recipient.contactId, pluginId))) return false;
      const { sendInapp } = await import("../../services/comm/senders/inapp");
      await sendInapp({
        contactId: recipient.contactId,
        userId,
        title: content.title,
        body: content.body,
        linkUrl: content.linkUrl,
        linkLabel: content.linkLabel,
        initiatedBy: SERVICE,
        tagIds,
      });
      return true;
    }

    if (medium === "postal") {
      if (!content.file && !content.templateId) return false;
      const addresses = await storage.contacts.addresses.getContactPostalByContact(
        recipient.contactId,
      );
      const active = addresses.filter((a) => a.isActive);
      const chosen = active.find((a) => a.isPrimary) ?? active[0];
      if (!chosen) return false;
      if (!(await passesNotificationFlood(medium, recipient.contactId, pluginId))) return false;
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
        tagIds,
      });
      return true;
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
  return false;
}

/**
 * Resolve (get-or-create) the comm tag ids every send for this plugin should
 * carry so the generated comms are filterable in the comm log: one stable
 * "Event Notifier" tag for the whole framework plus a per-plugin tag. Results
 * are cached by siriusId for the process lifetime. Tagging is best-effort — a
 * failure here must never block delivery.
 */
async function resolveTagIds(pluginId: string, pluginName: string): Promise<string[]> {
  const wanted: Array<{ siriusId: string; name: string }> = [
    { siriusId: "event-notifier", name: "Event Notifier" },
    { siriusId: `event-notifier:${pluginId}`, name: pluginName },
  ];
  const { storage } = await import("../../storage");
  const ids: string[] = [];
  for (const { siriusId, name } of wanted) {
    const cached = tagIdCache.get(siriusId);
    if (cached) {
      ids.push(cached);
      continue;
    }
    try {
      const tag = await storage.commTags.getOrCreateBySiriusId(siriusId, name);
      if (tag?.id) {
        tagIdCache.set(siriusId, tag.id);
        ids.push(tag.id);
      }
    } catch (error) {
      logger.warn("Event-notifier tag resolution failed", {
        service: SERVICE,
        pluginId,
        siriusId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return ids;
}

const tagIdCache = new Map<string, string>();

/**
 * Resolve the recipients for a staff-mode notifier from the config's chosen
 * staff/admin user ids. Each user is resolved to the contact that owns its
 * email address (that contact anchors every send + opt-out); the userId is
 * kept on the recipient so in-app delivery can target the authenticated user
 * directly. Users that can't be reached (missing user, no email, or no
 * matching contact) are logged and skipped rather than aborting the fan-out.
 */
async function resolveStaffRecipients(
  userIds: string[],
  pluginId: string,
): Promise<NotifierRecipient[]> {
  const { storage } = await import("../../storage");
  const recipients: NotifierRecipient[] = [];
  for (const userId of userIds) {
    try {
      const user = await storage.users.getUser(userId);
      if (!user?.email) {
        logger.warn("Event-notifier staff recipient unreachable", {
          service: SERVICE,
          pluginId,
          userId,
          reason: user ? "user has no email" : "user not found",
        });
        continue;
      }
      const contact = await storage.contacts.getContactByEmail(user.email);
      if (!contact) {
        logger.warn("Event-notifier staff recipient unreachable", {
          service: SERVICE,
          pluginId,
          userId,
          reason: "no contact matches user email",
        });
        continue;
      }
      recipients.push({ contactId: contact.id, userId: user.id });
    } catch (error) {
      logger.warn("Event-notifier staff recipient resolution failed", {
        service: SERVICE,
        pluginId,
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return recipients;
}

/** Read the staff recipient user ids off a config's `data` payload. */
function staffRecipientUserIds(configData: unknown): string[] {
  const data =
    configData && typeof configData === "object"
      ? (configData as Record<string, unknown>)
      : {};
  const ids = data.staffRecipientUserIds;
  if (!Array.isArray(ids)) return [];
  return ids.filter((v): v is string => typeof v === "string");
}

/**
 * Handle one fired event for one enabled config: resolve the active media (the
 * admin's selection intersected with the plugin's supportedMedia), fetch the
 * recipients, then deliver each (recipient, medium) message the plugin composes.
 * Staff-mode notifiers resolve their recipients from the config's chosen staff
 * users; all others delegate to the plugin's `getRecipients`.
 */
async function dispatchForConfig(
  pluginId: string,
  mediaSelection: NotificationMedium[],
  ctx: EventNotifierEventContext,
  configData: unknown,
): Promise<void> {
  const plugin = eventNotifierRegistry.get(pluginId);
  if (!plugin) return;
  if (!plugin.subscribedEvents.includes(ctx.event)) return;
  if (!isPluginComponentEnabledSync(plugin)) {
    return;
  }

  // Per-config gate (e.g. a role filter): skip this config when the plugin says
  // this event doesn't apply to it. Omitted hook = always dispatch.
  if (plugin.shouldDispatch) {
    const ok = await plugin.shouldDispatch(ctx, configData);
    if (!ok) return;
  }

  // Active media = admin selection ∩ what the plugin can actually produce.
  const supported = new Set(plugin.supportedMedia);
  const active = mediaSelection.filter((m) => supported.has(m));
  if (active.length === 0) return;

  const resolved = plugin.staffNotification
    ? await resolveStaffRecipients(staffRecipientUserIds(configData), plugin.id)
    : plugin.getRecipients
      ? await plugin.getRecipients(ctx, configData)
      : [];
  if (resolved.length === 0) return;

  // Self-notification suppression: when the user who triggered this event is
  // also a recipient, skip notifying them — they just performed the action, so
  // the notification would be pure noise. Matched by application user id off the
  // request context. Fail-safe: with no acting user (e.g. cron-fired events) or
  // a recipient with no resolved userId, nothing is dropped and we notify as
  // normal.
  const actingUserId = getRequestContext()?.userId;
  const recipients = actingUserId
    ? resolved.filter((r) => {
        const isSelf = r.userId === actingUserId;
        if (isSelf) {
          logger.debug("Skipping self-notification for acting user", {
            service: SERVICE,
            pluginId: plugin.id,
            event: ctx.event,
            contactId: r.contactId,
          });
        }
        return !isSelf;
      })
    : resolved;
  if (recipients.length === 0) return;

  const tagIds = await resolveTagIds(plugin.id, plugin.name);

  for (const recipient of recipients) {
    for (const medium of active) {
      const content = await plugin.getMessage(medium, recipient, ctx);
      if (!content) continue;
      const sent = await deliver(medium, recipient, content, pluginId, tagIds);
      // Flash a summary of what went out back to the user who triggered the
      // event. Only successful sends are tallied; self-notifications are already
      // filtered out above, and system/cron-fired events have no acting user so
      // nothing is flashed.
      if (sent && actingUserId) {
        recordSentNotification(actingUserId, medium);
      }
    }
  }
}

const KIND = "event-notifier";

/** Parse the subsidiary `media` column (comma-joined string) into a list. */
function parseMedia(value: unknown): NotificationMedium[] {
  if (typeof value !== "string" || value.length === 0) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean) as NotificationMedium[];
}

/**
 * Build the handler that fans a single fired event out to every enabled config.
 * The enabled event-notifier configs come from the shared, kind-indexed cache
 * (invalidated centrally when any config changes); the small set is filtered in
 * memory per emit — by which plugin subscribes to this event, and by the admin's
 * media selection — rather than querying the DB on every emit.
 */
function makeHandler(event: EventType) {
  return async (payload: unknown): Promise<void> => {
    if (areNotificationsSuppressed()) {
      logger.debug("Notifications suppressed for scope; skipping dispatch", {
        service: SERVICE,
        event,
      });
      return;
    }
    const ctx: EventNotifierEventContext = { event, payload };
    const envelopes = await getEnabledConfigsForKind(KIND);
    for (const envelope of envelopes) {
      const plugin = eventNotifierRegistry.get(envelope.config.pluginId);
      if (!plugin || !plugin.subscribedEvents.includes(event)) continue;

      const subsidiary = envelope.subsidiary as { media?: string | null } | null;
      const media = parseMedia(subsidiary?.media);
      if (media.length === 0) continue;

      try {
        await dispatchForConfig(
          envelope.config.pluginId,
          media,
          ctx,
          envelope.config.data,
        );
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
