import type { JsonSchema, UiSchema } from "@shared/json-schema-form";
import type { EventType } from "../../services/event-bus";
import type { BasePluginMetadata } from "../_core";

/**
 * The communication media an event-notifier can fan out to. Each maps to one
 * of the comm send functions (`sendEmail`, `sendSms`, `sendInapp`,
 * `sendPostal`). A plugin declares which media it is *capable* of producing a
 * message for (its `supportedMedia`); the admin selects the *active* subset per
 * config (persisted on the subsidiary `media` column).
 */
export type NotificationMedium = "email" | "sms" | "inapp" | "postal";

export const ALL_NOTIFICATION_MEDIA: readonly NotificationMedium[] = [
  "email",
  "sms",
  "inapp",
  "postal",
];

/**
 * A resolved recipient for a fired event. `contactId` anchors every send (the
 * comm layer keys delivery, opt-outs and tagging off it). `userId` is required
 * only for in-app messages (they deliver to an authenticated user); resolve it
 * (e.g. via `storage.users.getUserByEmail`) when the notifier supports in-app.
 */
export interface NotifierRecipient {
  contactId: string;
  userId?: string | null;
}

/**
 * The per-medium message content a notifier composes for one recipient. Only
 * the fields relevant to the medium being sent are read; the send wrapper picks
 * them out and ignores the rest. Returning `null` from {@link
 * EventNotifierPlugin.getMessage} skips that medium for that recipient.
 */
export interface NotifierMessageContent {
  // email
  subject?: string;
  bodyText?: string;
  bodyHtml?: string;
  // sms
  message?: string;
  // inapp
  title?: string;
  body?: string;
  linkUrl?: string;
  linkLabel?: string;
  // postal
  file?: string;
  templateId?: string;
  description?: string;
  mergeVariables?: Record<string, string>;
}

/**
 * Context handed to a notifier for a single fired event. `event` is the bus
 * event type and `payload` is its (untyped here) payload — the notifier
 * narrows it against the event-bus `EventPayloadMap`.
 */
export interface EventNotifierEventContext {
  event: EventType;
  payload: unknown;
}

/**
 * An event-notifier plugin. It subscribes to one or more event-bus events and
 * fans each fired event out to the comm send functions for every active
 * medium. The framework (the event-notifier "send wrapper") owns subscription,
 * config resolution, medium gating and the actual sends; a plugin only:
 *   - declares which events it cares about (`subscribedEvents`),
 *   - declares which media it can produce (`supportedMedia`),
 *   - resolves recipients for a fired event (`getRecipients`), and
 *   - composes the message for one recipient on one medium (`getMessage`).
 */
export interface EventNotifierPlugin extends BasePluginMetadata {
  /** Ordering hint mirrored onto manifest entries (ascending). */
  order?: number;
  /**
   * When true, this notifier targets a fixed list of internal staff/admin
   * users chosen per config rather than recipients derived from the event
   * payload. The framework resolves the recipients itself from the config's
   * `data.staffRecipientUserIds` (userId → user email → contact), so a
   * staff-mode plugin omits {@link getRecipients}.
   */
  staffNotification?: boolean;
  /**
   * JSON Schema describing the editable `data` fields the generic admin UI
   * renders for a config row of this notifier. Omit for notifiers with no
   * editable settings.
   */
  configSchema?: JsonSchema;
  /** Optional RJSF UI hints paired with {@link configSchema}. */
  uiSchema?: UiSchema;

  /** Event-bus events this notifier subscribes to. */
  subscribedEvents: EventType[];
  /** The media this notifier is capable of producing a message for. */
  supportedMedia: NotificationMedium[];

  /**
   * Resolve the recipients for a fired event. An empty array means "nobody to
   * notify" and the framework sends nothing. Omitted by staff-mode notifiers
   * ({@link staffNotification}): the framework resolves their recipients from
   * the config instead.
   */
  getRecipients?(
    ctx: EventNotifierEventContext,
    configData?: unknown,
  ): Promise<NotifierRecipient[]>;

  /**
   * Optional per-config gate evaluated before recipients are resolved. Receives
   * the fired event context and the individual config's `data` payload; return
   * `false` to skip this config for this event (e.g. the config restricts
   * notifications to a subset of roles that does not include the one on the
   * payload). Notifiers that omit this hook always dispatch.
   */
  shouldDispatch?(
    ctx: EventNotifierEventContext,
    configData: unknown,
  ): boolean | Promise<boolean>;

  /**
   * Compose the message for one recipient on one medium. Return `null` to skip
   * that medium for that recipient (e.g. the recipient has no address on file,
   * or the content does not apply).
   */
  getMessage(
    medium: NotificationMedium,
    recipient: NotifierRecipient,
    ctx: EventNotifierEventContext,
  ): Promise<NotifierMessageContent | null>;
}

export interface EventNotifierManifestEntry {
  id: string;
  name: string;
  description?: string;
  order: number;
  requiredComponent?: string;
  needsReadOnlyDb?: boolean;
  /** Attached by the kind's `decorateEntries` for the generic admin UI. */
  enabled?: boolean;
  configSchema?: JsonSchema;
  uiSchema?: UiSchema;
}
