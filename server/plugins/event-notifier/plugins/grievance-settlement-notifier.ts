import {
  EventType,
  type GrievanceSettlementSavedPayload,
} from "../../../services/event-bus";
import { registerEventNotifier } from "../registry";
import {
  type EventNotifierEventContext,
  type EventNotifierPlugin,
  type NotificationMedium,
  type NotifierMessageContent,
  type NotifierRecipient,
} from "../types";

function payloadOf(ctx: EventNotifierEventContext): GrievanceSettlementSavedPayload {
  return ctx.payload as GrievanceSettlementSavedPayload;
}

/**
 * Read the admin-configured grievance role filter off a config's `data`. Role
 * selection is REQUIRED for this notifier: an empty list means "notify nobody"
 * (getRecipients returns an empty array), so a misconfigured config never
 * silently blasts everyone.
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
 * Format a settlement amount as US currency. Whole-dollar amounts drop the
 * cents ("$100"), fractional amounts keep them ("$100.50"). Returns null when
 * the amount is missing or unparsable so the message can omit the figure.
 */
function formatAmount(amount: string | null): string | null {
  if (amount == null) return null;
  const num = Number(amount);
  if (!Number.isFinite(num)) return null;
  const hasCents = Math.round(num * 100) % 100 !== 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(num);
}

/**
 * Human-readable body line for each operation. Includes the settlement amount
 * when known; otherwise it drops the dollar figure but keeps the sentence
 * grammatical.
 */
function bodyFor(
  operation: GrievanceSettlementSavedPayload["operation"],
  grievanceTitle: string,
  amount: string | null,
): string {
  const money = formatAmount(amount);
  const settlement = money ? `A settlement of ${money}` : `A settlement`;
  switch (operation) {
    case "created":
      return `${settlement} was added to the grievance ${grievanceTitle}.`;
    case "deleted":
      return `${settlement} was removed from the grievance ${grievanceTitle}.`;
    case "updated":
    default:
      return `${settlement} on the grievance ${grievanceTitle} was updated.`;
  }
}

/**
 * Absolute URL to the grievance's settlement tab. In-app messages navigate with
 * a relative path, but email/SMS leave the app so they need a fully-qualified
 * link. Mirrors the domain resolution used by the other grievance notifiers.
 */
function absoluteSettlementUrl(grievanceId: string): string {
  const domain =
    process.env.REPLIT_DEV_DOMAIN ||
    process.env.REPLIT_DOMAINS?.split(",")[0] ||
    "localhost:5000";
  return `https://${domain}/grievance/${grievanceId}/settlements`;
}

/**
 * Notifies the users associated with a grievance whenever a settlement on that
 * grievance is added, updated, or removed. The settlement storage emits
 * `GRIEVANCE_SETTLEMENT_SAVED` and this plugin fans it out over the admin's
 * selected media (in-app / email / SMS — never postal).
 *
 * WHO is notified is driven by the required `roleIds` config: only associated
 * users holding one of the selected grievance roles receive the notice. The
 * user who performed the action is dropped by the dispatcher's self-notification
 * suppression (recipients carry their `userId`).
 */
export const grievanceSettlementNotifier: EventNotifierPlugin = {
  id: "grievance-settlement",
  name: "Grievance Settlement Notifier",
  description:
    "Notifies grievance-associated users (by selected role) when a settlement is added, updated, or removed.",
  order: 100,
  requiredComponent: "grievance.settlement",
  subscribedEvents: [EventType.GRIEVANCE_SETTLEMENT_SAVED],
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
    const allowed = new Set(configuredRoleIds(configData));
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
    // are notified once per settlement change.
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
    const { grievanceId, operation, amount } = payloadOf(ctx);
    const { storage } = await import("../../../storage");
    const info = await storage.grievances.getAssignmentTitleInfo(grievanceId);
    const grievanceTitle = composeTitle(grievanceId, info);
    const body = bodyFor(operation, grievanceTitle, amount);
    const linkUrl = `/grievance/${grievanceId}/settlements`;
    const absoluteUrl = absoluteSettlementUrl(grievanceId);
    const title = grievanceTitle;

    switch (medium) {
      case "inapp":
        return {
          title,
          body,
          linkUrl,
          linkLabel: "View Settlements",
        };
      case "email":
        return {
          subject: title,
          bodyText: `${body}\n\nView the settlement: ${absoluteUrl}`,
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

registerEventNotifier(grievanceSettlementNotifier);
