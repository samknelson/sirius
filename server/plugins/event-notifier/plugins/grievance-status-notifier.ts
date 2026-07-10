import {
  EventType,
  type GrievanceStatusHistorySavedPayload,
} from "../../../services/event-bus";
import { registerEventNotifier } from "../registry";
import {
  type EventNotifierEventContext,
  type EventNotifierPlugin,
  type NotificationMedium,
  type NotifierMessageContent,
  type NotifierRecipient,
} from "../types";

function payloadOf(
  ctx: EventNotifierEventContext,
): GrievanceStatusHistorySavedPayload {
  return ctx.payload as GrievanceStatusHistorySavedPayload;
}

/**
 * Read a required string-array config field off a config's `data`. Both the
 * trigger statuses and the notify roles are REQUIRED for this notifier: an
 * empty list means the config can never fire (shouldDispatch returns false) or
 * notifies nobody (getRecipients returns []), so a misconfigured config never
 * silently blasts everyone.
 */
function configuredIds(configData: unknown, key: string): string[] {
  const data =
    configData && typeof configData === "object"
      ? (configData as Record<string, unknown>)
      : {};
  const ids = data[key];
  if (!Array.isArray(ids)) return [];
  return ids.filter((v): v is string => typeof v === "string");
}

/**
 * Compose the grievance's display title, mirroring the client's
 * `grievanceTitle`: denorm name, else "<Category> Grievance", else
 * "Grievance <id-prefix>".
 */
function composeTitle(
  grievanceId: string,
  info: { name: string | null; categoryName: string | null } | undefined,
): string {
  if (info?.name && info.name.trim()) return info.name;
  if (info?.categoryName) return `${info.categoryName} Grievance`;
  return `Grievance ${grievanceId.slice(0, 8)}`;
}

/**
 * Absolute URL to the grievance detail page. In-app messages navigate with a
 * relative path, but email/SMS leave the app so they need a fully-qualified
 * link. Mirrors the domain resolution used by the other grievance notifiers.
 */
function absoluteGrievanceUrl(grievanceId: string): string {
  const domain =
    process.env.REPLIT_DEV_DOMAIN ||
    process.env.REPLIT_DOMAINS?.split(",")[0] ||
    "localhost:5000";
  return `https://${domain}/grievance/${grievanceId}`;
}

/**
 * Notifies the users associated with a grievance whenever the grievance's
 * derived current status transitions into one of the admin-selected trigger
 * statuses. Status changes emit `GRIEVANCE_STATUS_HISTORY_SAVED` (enriched with
 * the previous + new current status); this plugin fans a genuine transition
 * out over the admin's selected media (in-app / email / SMS — never postal).
 *
 * WHO is notified is driven by the required `roleIds` config: only associated
 * users holding one of the selected grievance roles receive the notice. WHEN it
 * fires is driven by the required `statusIds` config plus the transition gate in
 * `shouldDispatch` — it fires only when the new current status is one of the
 * configured statuses AND differs from the previous current status. The user who
 * performed the action is dropped by the dispatcher's self-notification
 * suppression (recipients carry their `userId`).
 */
export const grievanceStatusNotifier: EventNotifierPlugin = {
  id: "grievance-status-notifier",
  name: "Grievance Status Notifier",
  description:
    "Notifies grievance-associated users (by selected role) when a grievance's current status changes into one of the selected statuses.",
  order: 100,
  requiredComponent: "grievance",
  subscribedEvents: [EventType.GRIEVANCE_STATUS_HISTORY_SAVED],
  supportedMedia: ["inapp", "email", "sms"],
  configSchema: {
    type: "object",
    required: ["statusIds", "roleIds"],
    properties: {
      statusIds: {
        type: "array",
        title: "Trigger statuses",
        description:
          "Notify when the grievance's current status changes into one of these statuses. At least one status is required.",
        minItems: 1,
        items: { type: "string" },
        "x-options-resource": "grievance-status",
      },
      roleIds: {
        type: "array",
        title: "Notify roles",
        description:
          "Notify grievance-associated users who hold one of these roles. At least one role is required — with none selected, nobody is notified.",
        minItems: 1,
        items: { type: "string" },
        "x-options-resource": "grievance-role",
      },
    },
  },

  shouldDispatch(ctx, configData): boolean {
    const { previousStatusId, newStatusId } = payloadOf(ctx);
    // Only a genuine transition INTO a configured status. Ignore events that
    // left the current status unchanged (edits/deletes to non-current entries,
    // timeline-adjustment edits) and events that cleared the status entirely.
    if (!newStatusId) return false;
    if (newStatusId === previousStatusId) return false;
    const triggers = new Set(configuredIds(configData, "statusIds"));
    if (triggers.size === 0) return false;
    return triggers.has(newStatusId);
  },

  async getRecipients(ctx, configData): Promise<NotifierRecipient[]> {
    const allowed = new Set(configuredIds(configData, "roleIds"));
    // Role selection is required — no roles means notify nobody.
    if (allowed.size === 0) return [];

    const { grievanceId } = payloadOf(ctx);
    const { storage } = await import("../../../storage");
    const users = await storage.grievances.listUsers(grievanceId);
    const matched = users.filter(
      (u) => u.roleId != null && allowed.has(u.roleId) && !!u.email,
    );
    if (matched.length === 0) return [];

    const resolved = await Promise.all(
      matched.map(async (u) => {
        const contact = await storage.contacts.getContactByEmail(u.email!);
        return contact ? { contactId: contact.id, userId: u.userId } : null;
      }),
    );

    // A user may hold more than one matching role; dedupe by contact so they
    // are notified once per status transition.
    const byContact = new Map<string, NotifierRecipient>();
    for (const r of resolved) {
      if (r && !byContact.has(r.contactId)) byContact.set(r.contactId, r);
    }
    return Array.from(byContact.values());
  },

  async getMessage(
    medium: NotificationMedium,
    _recipient: NotifierRecipient,
    ctx: EventNotifierEventContext,
  ): Promise<NotifierMessageContent | null> {
    const { grievanceId, newStatusName } = payloadOf(ctx);
    const { storage } = await import("../../../storage");
    const info = await storage.grievances.getAssignmentTitleInfo(grievanceId);
    const grievanceTitle = composeTitle(grievanceId, info);
    // The status name rides on the event payload; fall back to neutral phrasing
    // if the status option can't be named (e.g. it was removed).
    const status =
      newStatusName && newStatusName.trim() ? newStatusName : "a new status";
    const body = `The grievance "${grievanceTitle}" has reached the status "${status}".`;
    const linkUrl = `/grievance/${grievanceId}`;
    const absoluteUrl = absoluteGrievanceUrl(grievanceId);
    const title = grievanceTitle;

    switch (medium) {
      case "inapp":
        return {
          title,
          body,
          linkUrl,
          linkLabel: "View Grievance",
        };
      case "email":
        return {
          subject: title,
          bodyText: `${body}\n\nView the grievance: ${absoluteUrl}`,
        };
      case "sms":
        return {
          message: `${body} View: ${absoluteUrl}`,
        };
      default:
        return null;
    }
  },
};

registerEventNotifier(grievanceStatusNotifier);
