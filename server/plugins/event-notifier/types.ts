import type { Comm } from "@shared/schema";
import type { JsonSchema, UiSchema } from "@shared/json-schema-form";
import type { EventType } from "../../services/event-bus";
import type { BasePluginMetadata } from "../_core";
import type { TokenEntity } from "../tokens/types";

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
 * Per-channel message templates for a token-templated notifier. Every
 * value is a token template string rendered per recipient (recipient
 * roots like `contact.`/`worker.` mean the recipient; the notifier's
 * own {@link NotifierRecordRoot}s name the records the event is about;
 * `event.` is the event envelope — which event, when it fired;
 * `{{system.base_url}}` is the absolute origin on email/SMS and empty
 * in-app).
 *
 * Links are not spelled out here: a record that has a page offers
 * `{{x.url}}` (absolute, for email/SMS) and `{{x.path}}` (relative, for
 * the in-app link), with an optional `tab` for a sub-page.
 */
export interface NotifierChannelTemplates {
  email?: {
    subject: string;
    /** HTML body; token values are HTML-escaped on render. */
    bodyHtml: string;
  };
  sms?: { message: string };
  inapp?: {
    title: string;
    body: string;
    /** Relative link (in-app navigation); rendered as a template too. */
    linkUrl?: string;
    linkLabel?: string;
  };
}

/**
 * ONE RECORD this notifier's messages are about, seeded as a token root
 * of its own and written as itself:
 * `{{dispatch.field(name="status_label")}}`,
 * `{{grievance_settlement.grievance.field(name="number")}}`.
 *
 * A notifier declares one root per record it has to talk about. There
 * is no `{{event.<record>}}` spelling — `event` is the envelope (which
 * event, when) and nothing more.
 */
export interface NotifierRecordRoot {
  /**
   * Root name as written in templates. It IS the token entity kind, which
   * is the table, which is the code: a template author reading
   * `{{grievance_status_history.…}}` can look the record up and find out
   * exactly what it holds. A shortened or prettified name (`grievance_status`
   * for a `grievance_status_history` row) reads like a different record than
   * the one it carries. Nothing enforces this — it is on the author.
   *
   * The name is global across notifiers: two notifiers may share one, but
   * only for the same entity kind.
   */
  name: string;
  /** Token entity kind of the seeded record. */
  kind: string;
  /** Human label for the picker ("Dispatch status"). */
  label: string;
  description?: string;
  /**
   * Values `build` MERGES onto the row beyond the table's own columns
   * (`status_label`, `action_label`). Declaring them is what makes
   * `{{dispatch.field(name="status_label")}}` valid instead of an
   * `[unknown token: …]` in a delivered message.
   *
   * Use sparingly, and never for a value that belongs to a RELATED record:
   * a flattened `grievance_title` reads like a column of the record it is
   * merged onto, so the template says something the schema does not, and it
   * only resolves for as long as whoever seeds the record remembers to merge
   * it. Reach the related record instead.
   */
  fields?: string[];
  /**
   * Component the ROOT is gated on, when that is not the notifier's own.
   * A root inherits `requiredComponent` from its notifier, which is right
   * for the record the notifier is about and wrong for a related record it
   * seeds: the settlement notifier is gated on `grievance.settlement`, but
   * the grievance it seeds alongside is a `grievance` record and another
   * notifier declaring the same root says so. Two surfaces sharing a root
   * name must gate it identically, so gate a root on the component that
   * OWNS its entity kind.
   */
  requiredComponent?: string;
  /**
   * Build the record for a fired event. Returning null normally ABORTS
   * composition for this config (an already-deleted row means there is
   * nothing truthful to say); mark the root `optional` when a missing
   * record should instead just leave its tokens at their defaults.
   */
  build(ctx: EventNotifierEventContext): Promise<TokenEntity | null>;
  /** Null from `build` leaves this root unseeded instead of aborting. */
  optional?: boolean;
}

/**
 * Opt-in declaration that a notifier's messages are composed by the
 * FRAMEWORK from token templates instead of the plugin's `getMessage`.
 * Custom per-channel templates live in the config's `data.templates`
 * (same shape as {@link NotifierChannelTemplates}); a blank/absent
 * custom field falls back to the default from `defaultTemplates`.
 */
export interface NotifierTokenTemplates {
  /**
   * The records this notifier's messages are about, each a named root.
   * The framework seeds them per fired event and registers them with
   * the token registry so the editor offers exactly these roots.
   */
  roots: NotifierRecordRoot[];
  /**
   * The default per-channel templates. Receives the config's `data` so
   * defaults can vary with config choices (e.g. link target per
   * recipient kind).
   */
  defaultTemplates(configData?: unknown): NotifierChannelTemplates;
  // Preview contexts are not declared here. Named sample data comes
  // from the token plugins' `sampleSets`; a real record is named by the
  // caller and gated by the entity kind's own `previewEntity`
  // declaration (server/plugins/tokens/preview-entities.ts).
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
   * When true, the dispatcher does NOT drop the acting user from the recipient
   * list (its "self-notification suppression"). Suppression exists so a user
   * who just performed an action isn't notified about their own real-time
   * change; but for scheduled EBS-pump reminders (e.g. "2 days until this
   * grievance's deadline") the recipient legitimately wants the reminder even
   * if they created or last touched the entity — and manually running the pump
   * would otherwise suppress the operator. Defaults to false (suppress).
   */
  notifySelf?: boolean;
  /**
   * JSON Schema describing the editable `data` fields the generic admin UI
   * renders for a config row of this notifier. Omit for notifiers with no
   * editable settings.
   */
  configSchema?: JsonSchema;
  /** Optional RJSF UI hints paired with {@link configSchema}. */
  uiSchema?: UiSchema;

  /**
   * Opt-in token-template message composition. When declared, the
   * dispatcher renders the per-channel templates (custom from
   * `data.templates`, else the declared defaults) and the plugin's
   * {@link getMessage} is not called. Notifiers without this
   * declaration are untouched.
   */
  tokenTemplates?: NotifierTokenTemplates;

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
   * or the content does not apply). `configData` is the individual config's
   * `data` payload, for notifiers whose message text is admin-configurable
   * (e.g. a per-config subject/intro); plugins that don't need it ignore it.
   * Optional for notifiers that declare {@link tokenTemplates} — the
   * framework composes their messages instead.
   */
  getMessage?(
    medium: NotificationMedium,
    recipient: NotifierRecipient,
    ctx: EventNotifierEventContext,
    configData?: unknown,
  ): Promise<NotifierMessageContent | null>;

  /**
   * Optional post-send hook, called once per (recipient, medium) with the comm
   * record that send created. Notifiers never create comm records themselves —
   * the send layer does — so this is the only point at which one can learn the
   * id of the message it caused, and link it back to whatever the message was
   * about (e.g. stamping it onto the row the recipient was contacted over).
   *
   * Fires whenever the send layer HANDS BACK a record, including for a send
   * that failed: a recorded failure is worth linking too, and is more
   * informative than a blank. Hence "comm created", not "delivered" — a call
   * is not proof the message arrived, or even that a provider was reached
   * (an unreachable recipient is recorded as a failure without one), and the
   * record's own status remains the authority on that. Nothing is called when
   * no record comes back: no address on file, flood-limited, the sender threw,
   * or the sender created a record and then failed before returning it.
   *
   * Best-effort and strictly after the fact. The send layer's transaction has
   * already committed and the message has already been handed off, so this
   * hook can neither roll back nor retry the message, and must not try. The
   * framework catches and logs whatever it throws and moves on to the next
   * recipient, so one plugin's bookkeeping failure never costs another
   * recipient their message.
   */
  onCommCreated?(
    medium: NotificationMedium,
    recipient: NotifierRecipient,
    comm: Comm,
    ctx: EventNotifierEventContext,
    configData?: unknown,
  ): Promise<void>;
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
