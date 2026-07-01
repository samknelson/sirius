import {
  EventType,
  type GrievanceAssignmentSavedPayload,
} from "../../../services/event-bus";
import { registerEventNotifier } from "../registry";
import {
  type EventNotifierEventContext,
  type EventNotifierPlugin,
  type NotificationMedium,
  type NotifierMessageContent,
  type NotifierRecipient,
} from "../types";

function payloadOf(ctx: EventNotifierEventContext): GrievanceAssignmentSavedPayload {
  return ctx.payload as GrievanceAssignmentSavedPayload;
}

/**
 * Read the admin-configured grievance role filter off a config's `data`. An
 * empty list means "all roles" — the config fires for every assignment.
 */
function configuredRoleIds(configData: unknown): string[] {
  const data =
    configData && typeof configData === "object"
      ? (configData as Record<string, unknown>)
      : {};
  const ids = data.roleIds;
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
 * Human-readable body line for each operation. The role is always named — if
 * the role option can't be resolved (e.g. it was removed) a stable placeholder
 * is used so the message never drops the required role phrasing.
 */
function bodyFor(
  operation: GrievanceAssignmentSavedPayload["operation"],
  grievanceTitle: string,
  roleName: string | null,
): string {
  const role = roleName && roleName.trim() ? roleName : "a grievance role";
  switch (operation) {
    case "created":
      return `You have been assigned to the grievance "${grievanceTitle}" as ${role}.`;
    case "deleted":
      return `You have been unassigned from the grievance "${grievanceTitle}" (previously ${role}).`;
    case "updated":
    default:
      return `Your role on the grievance "${grievanceTitle}" has been changed to ${role}.`;
  }
}

/**
 * Absolute URL to the grievance detail page. In-app messages navigate with a
 * relative path, but email/SMS leave the app so they need a fully-qualified
 * link. Mirrors the domain resolution used by the dispatch notifier.
 */
function absoluteGrievanceUrl(grievanceId: string): string {
  const domain =
    process.env.REPLIT_DEV_DOMAIN ||
    process.env.REPLIT_DOMAINS?.split(",")[0] ||
    "localhost:5000";
  return `https://${domain}/grievance/${grievanceId}`;
}

/**
 * Notifies the affected user when they are assigned to, unassigned from, or have
 * their role changed on a grievance. The grievance-user assignment storage emits
 * `GRIEVANCE_ASSIGNMENT_SAVED` and this plugin fans it out over the admin's
 * selected media (in-app / email / SMS — never postal). Admins may optionally
 * restrict a config to specific grievance roles via `data.roleIds`.
 */
export const grievanceAssignmentNotifier: EventNotifierPlugin = {
  id: "grievance-assignment-notifier",
  name: "Grievance Assignment Notifier",
  description:
    "Notifies a user when they are assigned to, unassigned from, or have their role changed on a grievance.",
  order: 100,
  requiredComponent: "grievance",
  subscribedEvents: [EventType.GRIEVANCE_ASSIGNMENT_SAVED],
  supportedMedia: ["inapp", "email", "sms"],
  configSchema: {
    type: "object",
    properties: {
      roleIds: {
        type: "array",
        title: "Restrict to roles",
        description:
          "Only notify when the affected assignment uses one of these grievance roles. Leave empty to notify for every role.",
        items: { type: "string" },
        "x-options-resource": "grievance-role",
      },
    },
  },

  shouldDispatch(ctx, configData): boolean {
    const allowed = configuredRoleIds(configData);
    if (allowed.length === 0) return true;
    return allowed.includes(payloadOf(ctx).roleId);
  },

  async getRecipients(ctx): Promise<NotifierRecipient[]> {
    const { userId } = payloadOf(ctx);
    if (!userId) return [];
    const { storage } = await import("../../../storage");
    const user = await storage.users.getUser(userId);
    if (!user?.email) return [];
    const contact = await storage.contacts.getContactByEmail(user.email);
    if (!contact) return [];
    return [{ contactId: contact.id, userId: user.id }];
  },

  async getMessage(
    medium: NotificationMedium,
    _recipient: NotifierRecipient,
    ctx: EventNotifierEventContext,
  ): Promise<NotifierMessageContent | null> {
    const { grievanceId, roleId, operation } = payloadOf(ctx);
    const { storage } = await import("../../../storage");
    const [info, roleName] = await Promise.all([
      storage.grievances.getAssignmentTitleInfo(grievanceId),
      storage.grievances.getRoleName(roleId),
    ]);
    const grievanceTitle = composeTitle(grievanceId, info);
    const body = bodyFor(operation, grievanceTitle, roleName);
    // The link is omitted on unassignment: the user no longer has access to the
    // grievance, so pointing them at it would be a dead end.
    const hasLink = operation !== "deleted";
    const linkUrl = hasLink ? `/grievance/${grievanceId}` : undefined;
    const absoluteUrl = hasLink ? absoluteGrievanceUrl(grievanceId) : undefined;
    // The notification is titled with the grievance's display title; the body
    // carries the assignment detail (role + operation).
    const title = grievanceTitle;

    switch (medium) {
      case "inapp":
        return {
          title,
          body,
          linkUrl,
          linkLabel: linkUrl ? "View Grievance" : undefined,
        };
      case "email":
        return {
          subject: title,
          bodyText: absoluteUrl
            ? `${body}\n\nView the grievance: ${absoluteUrl}`
            : body,
        };
      case "sms":
        return {
          message: absoluteUrl ? `${body} View: ${absoluteUrl}` : body,
        };
      default:
        return null;
    }
  },
};

registerEventNotifier(grievanceAssignmentNotifier);
