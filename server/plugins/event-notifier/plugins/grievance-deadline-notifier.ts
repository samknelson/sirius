import {
  EventType,
  type GrievanceDeadlineReminderPayload,
} from "../../../services/event-bus";
import { registerEventNotifier } from "../registry";
import {
  type EventNotifierEventContext,
  type EventNotifierPlugin,
  type NotificationMedium,
  type NotifierMessageContent,
  type NotifierRecipient,
} from "../types";

function payloadOf(ctx: EventNotifierEventContext): GrievanceDeadlineReminderPayload {
  return ctx.payload as GrievanceDeadlineReminderPayload;
}

/**
 * Read a required string-array config field off a config's `data`. The notify
 * roles are REQUIRED: an empty list means the config notifies nobody
 * (getRecipients returns []), so a misconfigured config never silently blasts
 * everyone.
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
 * Delivers a grievance deadline reminder when the generic EBS pump fires a
 * scheduled `GRIEVANCE_DEADLINE_REMINDER` event (one per configured offset —
 * default 2, 11, and 14 days BEFORE a step's due date). WHEN each reminder fires
 * is owned by the `grievance_deadline_reminder` denorm plugin's offsets; this
 * notifier resolves WHO is notified from the grievance's associated users
 * filtered by the required `roleIds` config, and shapes the per-medium message.
 * The user who triggered the underlying change is dropped by the dispatcher's
 * self-notification suppression (recipients carry their `userId`).
 */
export const grievanceDeadlineNotifier: EventNotifierPlugin = {
  id: "grievance-deadline-notifier",
  name: "Grievance Deadline Reminder Notifier",
  description:
    "Notifies grievance-associated users (by selected role) a configurable number of days before a grievance step's due date.",
  order: 100,
  requiredComponent: "grievance",
  subscribedEvents: [EventType.GRIEVANCE_DEADLINE_REMINDER],
  supportedMedia: ["inapp", "email", "sms"],
  configSchema: {
    type: "object",
    required: ["roleIds"],
    properties: {
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
    // are notified once per reminder.
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
    const { grievanceId, stepName, dueDate, offset } = payloadOf(ctx);
    const { storage } = await import("../../../storage");
    const info = await storage.grievances.getAssignmentTitleInfo(grievanceId);
    const grievanceTitle = composeTitle(grievanceId, info);
    const step = stepName && stepName.trim() ? stepName : "a step";
    const dayWord = offset === 1 ? "day" : "days";
    const body = `The grievance "${grievanceTitle}" has ${step} due on ${dueDate} — ${offset} ${dayWord} from now.`;
    const linkUrl = `/grievance/${grievanceId}`;
    const absoluteUrl = absoluteGrievanceUrl(grievanceId);
    const title = "Grievance Deadline Reminder";

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

registerEventNotifier(grievanceDeadlineNotifier);
