import {
  EventType,
  type EdlsSheetSavedPayload,
} from "../../../services/event-bus";
import { registerEventNotifier } from "../registry";
import {
  type EventNotifierEventContext,
  type EventNotifierPlugin,
  type NotificationMedium,
  type NotifierMessageContent,
  type NotifierRecipient,
} from "../types";

function payloadOf(ctx: EventNotifierEventContext): EdlsSheetSavedPayload {
  return ctx.payload as EdlsSheetSavedPayload;
}

/**
 * Read a required string-array config field off a config's `data`. Both the
 * trigger statuses and the recipient roles are REQUIRED for this notifier: an
 * empty list means the config can never fire (shouldDispatch returns false) or
 * notifies nobody (getRecipients returns []), so a misconfigured config never
 * silently blasts everyone.
 */
function configuredValues(configData: unknown, key: string): string[] {
  const data =
    configData && typeof configData === "object"
      ? (configData as Record<string, unknown>)
      : {};
  const values = data[key];
  if (!Array.isArray(values)) return [];
  return values.filter((v): v is string => typeof v === "string");
}

const RECIPIENT_SHEET_SUPERVISOR = "sheet_supervisor";
const RECIPIENT_SHEET_ASSIGNEE = "sheet_assignee";
const RECIPIENT_CREW_SUPERVISORS = "crew_supervisors";

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  request: "Request",
  lock: "Locked",
  trash: "Trash",
  reserved: "Reserved",
};

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

/**
 * Absolute URL to the sheet detail page. In-app messages navigate with a
 * relative path, but email/SMS leave the app so they need a fully-qualified
 * link. Mirrors the domain resolution used by the other notifiers.
 */
function absoluteSheetUrl(sheetId: string): string {
  const domain =
    process.env.REPLIT_DEV_DOMAIN ||
    process.env.REPLIT_DOMAINS?.split(",")[0] ||
    "localhost:5000";
  return `https://${domain}/edls/sheet/${sheetId}`;
}

/**
 * Notifies the staff users attached to an EDLS sheet whenever the sheet
 * ARRIVES at one of the admin-selected trigger statuses — via a status change,
 * or by being created directly in a configured status (create carries
 * `previousStatus: null`, which never equals a real status, so it always
 * counts as an arrival). Edits that leave the status unchanged never fire.
 *
 * WHO is notified is driven by the required `recipientTypes` config: the
 * sheet's supervisor, the sheet's assignee, and/or the supervisors of the
 * sheet's crews — all staff users, never workers. Recipients are deduped by
 * contact so a user holding several roles (e.g. supervisor AND assignee) is
 * notified once. The user who performed the action is dropped by the
 * dispatcher's self-notification suppression (recipients carry their
 * `userId`).
 */
export const edlsSheetStatusNotifier: EventNotifierPlugin = {
  id: "edls-sheet-status-notifier",
  name: "EDLS Sheet Status Notifier",
  description:
    "Notifies the sheet supervisor, sheet assignee, and/or crew supervisors when an EDLS sheet arrives at one of the selected statuses (including being created in one).",
  order: 100,
  requiredComponent: "edls",
  subscribedEvents: [EventType.EDLS_SHEET_SAVED],
  supportedMedia: ["inapp", "email", "sms"],
  configSchema: {
    type: "object",
    required: ["statuses", "recipientTypes"],
    properties: {
      statuses: {
        type: "array",
        title: "Trigger statuses",
        description:
          "Notify when a sheet arrives at one of these statuses (by status change, or by being created in one). At least one status is required.",
        minItems: 1,
        uniqueItems: true,
        items: {
          type: "string",
          enum: ["draft", "request", "lock", "trash", "reserved"],
          enumNames: ["Draft", "Request", "Locked", "Trash", "Reserved"],
        },
      },
      recipientTypes: {
        type: "array",
        title: "Notify",
        description:
          "Which of the sheet's staff to notify. At least one is required — with none selected, nobody is notified.",
        minItems: 1,
        uniqueItems: true,
        items: {
          type: "string",
          enum: [
            RECIPIENT_SHEET_SUPERVISOR,
            RECIPIENT_SHEET_ASSIGNEE,
            RECIPIENT_CREW_SUPERVISORS,
          ],
          enumNames: [
            "Sheet supervisor",
            "Sheet assignee",
            "Crew supervisors",
          ],
        },
      },
    },
  },

  shouldDispatch(ctx, configData): boolean {
    const { previousStatus, newStatus } = payloadOf(ctx);
    // Only a genuine ARRIVAL at a configured status. Creates carry
    // previousStatus: null, so a sheet created directly in a configured
    // status fires; edits that leave the status unchanged never do.
    if (!newStatus) return false;
    if (newStatus === previousStatus) return false;
    const triggers = new Set(configuredValues(configData, "statuses"));
    if (triggers.size === 0) return false;
    return triggers.has(newStatus);
  },

  async getRecipients(ctx, configData): Promise<NotifierRecipient[]> {
    const wanted = new Set(configuredValues(configData, "recipientTypes"));
    // Recipient selection is required — none selected means notify nobody.
    if (wanted.size === 0) return [];

    const { sheetId } = payloadOf(ctx);
    const { storage } = await import("../../../storage");

    // Collect the wanted users (staff only — workers are never notified).
    const userMap = new Map<string, { userId: string; email: string }>();
    const addUser = (
      u: { id: string; email: string } | undefined,
    ): void => {
      if (u?.id && u.email && !userMap.has(u.id)) {
        userMap.set(u.id, { userId: u.id, email: u.email });
      }
    };

    if (
      wanted.has(RECIPIENT_SHEET_SUPERVISOR) ||
      wanted.has(RECIPIENT_SHEET_ASSIGNEE)
    ) {
      const sheet = await storage.edlsSheets.getWithRelations(sheetId);
      if (sheet) {
        if (wanted.has(RECIPIENT_SHEET_SUPERVISOR)) addUser(sheet.supervisorUser);
        if (wanted.has(RECIPIENT_SHEET_ASSIGNEE)) addUser(sheet.assigneeUser);
      }
    }

    if (wanted.has(RECIPIENT_CREW_SUPERVISORS)) {
      const crews = await storage.edlsCrews.getBySheetIdWithRelations(sheetId);
      for (const crew of crews) addUser(crew.supervisorUser);
    }

    if (userMap.size === 0) return [];

    const resolved = await Promise.all(
      Array.from(userMap.values()).map(async (u) => {
        const contact = await storage.contacts.getContactByEmail(u.email);
        return contact ? { contactId: contact.id, userId: u.userId } : null;
      }),
    );

    // Several roles may resolve to the same contact; dedupe so each person is
    // notified once per arrival.
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
    const { sheetId, newStatus, title: sheetTitle, ymd } = payloadOf(ctx);
    const name =
      sheetTitle && sheetTitle.trim()
        ? sheetTitle
        : `Sheet ${sheetId.slice(0, 8)}`;
    const body = `The EDLS sheet "${name}" (${ymd}) has reached the status "${statusLabel(newStatus)}".`;
    const linkUrl = `/edls/sheet/${sheetId}`;
    const absoluteUrl = absoluteSheetUrl(sheetId);

    switch (medium) {
      case "inapp":
        return {
          title: name,
          body,
          linkUrl,
          linkLabel: "View Sheet",
        };
      case "email":
        return {
          subject: name,
          bodyText: `${body}\n\nView the sheet: ${absoluteUrl}`,
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

registerEventNotifier(edlsSheetStatusNotifier);
