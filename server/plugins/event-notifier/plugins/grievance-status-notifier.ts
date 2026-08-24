import {
  EventType,
  type GrievanceStatusHistorySavedPayload,
} from "../../../services/event-bus";
import { registerEventNotifier } from "../registry";
import { templatesSchemaBlock } from "../template-schema";
import {
  type EventNotifierEventContext,
  type EventNotifierPlugin,
  type NotifierChannelTemplates,
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
 * Default per-channel templates.
 *
 * `grievance_status_history` is the status-history ROW the event is about,
 * loaded by its own id (so a later transition can't make the message
 * describe a status this entry never had). `grievance` is the linked
 * grievance, seeded as its own root.
 *
 * Both are written as the bare record: a record token renders the kind's
 * default leaf, which is the grievance's `display_title` (the same title
 * the grievance pages show) and the entry's status name.
 */
const TITLE = "Grievance - status change - {{grievance}}";
const SENTENCE =
  'The grievance "{{grievance}}" ' +
  'has reached the status "{{grievance_status_history}}".';
// The grievance says where its own page is (see the kind's declared
// entity location), so nothing here re-spells the route: `url` for the
// channels that leave the app, `path` for the in-app link.
const LINK_URL = "{{grievance.url}}";
const LINK_PATH = "{{grievance.path}}";
const LINK_LABEL = "View Grievance";

function defaultTemplates(): NotifierChannelTemplates {
  return {
    email: {
      subject: TITLE,
      bodyHtml:
        `<p>${SENTENCE}<br><br>` +
        `View the grievance: ` +
        `<a href="${LINK_URL}">` +
        `${LINK_URL}</a></p>`,
    },
    sms: {
      message: `${SENTENCE} View: ${LINK_URL}`,
    },
    inapp: {
      title: TITLE,
      body: SENTENCE,
      linkUrl: LINK_PATH,
      linkLabel: LINK_LABEL,
    },
  };
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
      templates: templatesSchemaBlock({
        exampleTokens: [
          '{{grievance.field(name="sirius_id")}}',
          '{{grievance_status_history.field(name="status_id")}}',
        ],
      }),
    },
  },

  tokenTemplates: {
    // Declaration order is what the editor shows: the message is about a
    // grievance, so the grievance leads and the entry it just reached
    // follows.
    roots: [
      {
        name: "grievance",
        kind: "grievance",
        label: "Grievance",
        description: "The grievance whose status changed",
        async build(ctx) {
          // Convenience root: the grievance is also reachable from the entry
          // (`grievance_status_history.grievance`), but the message is about
          // a grievance, so templates get to say so directly.
          const { grievanceId } = payloadOf(ctx);
          const { storage } = await import("../../../storage");
          const { buildGrievanceEntity } = await import(
            "../../tokens/plugins/grievance"
          );
          return buildGrievanceEntity(storage, grievanceId);
        },
      },
      {
        name: "grievance_status_history",
        kind: "grievance_status_history",
        label: "Grievance status entry",
        description: "The status entry the grievance has just reached",
        async build(ctx) {
          const { grievanceId, newStatusHistoryId } = payloadOf(ctx);
          // The event names the entry that is current after the mutation;
          // load THAT row rather than re-reading "the grievance's current
          // status", which a later transition could already have moved on
          // from. Every column the editor offers is therefore a real value.
          // A row deleted between the event and delivery leaves nothing
          // truthful to say, so composition aborts (null, root not optional).
          if (!newStatusHistoryId) return null;
          const { grievanceStatusHistory } = await import(
            "../../../../shared/schema/grievance/schema"
          );
          const { storage } = await import("../../../storage");
          const row = await storage.grievanceStatusHistory.get(
            grievanceId,
            newStatusHistoryId,
          );
          if (!row) return null;
          return {
            kind: "grievance_status_history",
            row: row as unknown as Record<string, unknown>,
            table: grievanceStatusHistory,
          };
        },
      },
    ],
    defaultTemplates,
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
};

registerEventNotifier(grievanceStatusNotifier);
