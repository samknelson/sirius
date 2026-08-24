import type { Comm } from "@shared/schema";
import { getTodayYmd, isValidYmd, isYmdBefore } from "@shared/utils/date";
import {
  EventType,
  type EdlsSheetSavedPayload,
} from "../../../services/event-bus";
import { absoluteUrl } from "../../../lib/base-url";
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
 * Read the required trigger-status list off a config's `data`. An empty list
 * means the config can never fire — a misconfigured config must never text
 * every assigned worker on every save.
 */
function configuredStatuses(configData: unknown): string[] {
  const data =
    configData && typeof configData === "object"
      ? (configData as Record<string, unknown>)
      : {};
  const values = data.statuses;
  if (!Array.isArray(values)) return [];
  return values.filter((v): v is string => typeof v === "string");
}

/**
 * Whether the sheet's date is one workers can still act on: today or later.
 *
 * `ymd` is a date-only column, so it is compared as a plain `YYYY-MM-DD`
 * string against the same local "today" the rest of the server uses (the TOS
 * view, the public schedule, dispatch polling). No `Date` is constructed —
 * that would reintroduce the timezone drift these helpers exist to avoid.
 *
 * A missing or malformed date fails CLOSED: it is not notifiable. The
 * alternative is guessing at what day the sheet is for and texting workers
 * about it, which is exactly the wrong answer to be confident about — same
 * stance the status gate takes on a config with no trigger statuses.
 */
function isNotifiableSheetYmd(ymd: unknown): boolean {
  if (!isValidYmd(ymd)) return false;
  return !isYmdBefore(ymd, getTodayYmd());
}

/**
 * The message body. Fixed wording: the link differs per recipient, and token
 * record roots are built once per event rather than once per recipient, so
 * this notifier composes its own message instead of going through the
 * template path.
 */
const SENTENCE =
  "Your crew assignment has been posted or updated. Please follow the link below and accept.";

/**
 * The worker's own EDLS schedule page, keyed by THEIR assignment id.
 *
 * `/edls-sched/:assignment_uuid` is the public worker schedule page, which is
 * a SEPARATE, already-drafted piece of work and is deliberately not built
 * here: knowing the assignment UUID is the credential, the page is logged-out
 * readable, and it decides for itself which sheets it will show. Until it
 * lands this link 404s, which is the accepted sequencing — the notifier owns
 * WHO is texted and WHICH assignment each link names, and the page owns what
 * the link resolves to. The route is not re-spelled anywhere else in this
 * plugin.
 *
 * Absolute, because an SMS is read outside the app.
 */
function assignmentScheduleUrl(assignmentId: string): string {
  return absoluteUrl(`/edls-sched/${assignmentId}`);
}

/**
 * Which assignment each recipient contact was resolved from, remembered for
 * the span of one dispatched event. `getRecipients` already reads the sheet's
 * assignments to decide who to text; `getMessage` needs the same answer to
 * build that recipient's link, and re-reading it per message would both cost a
 * query per worker and risk answering differently than the recipient list did.
 * Keyed weakly by the event context, so it is dropped with the event.
 */
const assignmentByContact = new WeakMap<
  EventNotifierEventContext,
  Map<string, string>
>();

/**
 * Texts the WORKERS assigned to an EDLS sheet when the sheet ARRIVES at one of
 * the admin-selected statuses (in practice "Locked"): a status change, or a
 * sheet created directly in that status. Saves that leave the status unchanged
 * never fire.
 *
 * DELIBERATELY BLIND TO PAST SHEETS. A sheet dated before today never texts
 * anyone, whatever its status change: the message tells a worker to go accept
 * a crew assignment, and there is nothing left to accept on a day that has
 * already happened. Re-locking or correcting an old sheet is a routine
 * back-office act and used to blast every assigned worker with a text that was
 * always wrong. This is unconditional — there is no admin setting for it, and
 * it is not a bug to "fix" back. A sheet dated today or later is unaffected.
 *
 * This is deliberately separate from `edls-sheet-status-notifier`, which
 * notifies the sheet's STAFF (supervisor, assignee, crew supervisors) across
 * every medium. Here the recipients are the assigned workers, the only medium
 * is SMS, and each worker's message carries a link to their OWN assignment.
 * That sibling notifier intentionally does NOT share the past-date rule: staff
 * still want to hear about corrections to a finished day, because a correction
 * is the whole point of the message they get.
 *
 * Recipients are pre-filtered to workers who can actually receive a text — an
 * active primary number that has recorded an SMS opt-in — because the SMS
 * sender records a FAILED communication for every un-opted-in number it is
 * handed, and a locked sheet should not litter the comm log with one failure
 * per opted-out worker.
 */
export const edlsSheetWorkerSmsNotifier: EventNotifierPlugin = {
  id: "edls-sheet-worker-sms-notifier",
  name: "EDLS Sheet Worker SMS Notifier",
  description:
    "Texts the workers assigned to an EDLS sheet, each with a link to their own schedule, when the sheet arrives at one of the selected statuses.",
  order: 110,
  requiredComponent: "edls",
  subscribedEvents: [EventType.EDLS_SHEET_SAVED],
  supportedMedia: ["sms"],
  configSchema: {
    type: "object",
    required: ["statuses"],
    properties: {
      statuses: {
        type: "array",
        title: "Trigger statuses",
        description:
          "Text the assigned workers when a sheet arrives at one of these statuses (by status change, or by being created in one). At least one status is required.",
        minItems: 1,
        uniqueItems: true,
        items: {
          type: "string",
          enum: ["draft", "request", "lock", "trash", "reserved"],
          enumNames: ["Draft", "Request", "Locked", "Trash", "Reserved"],
        },
      },
    },
  },

  shouldDispatch(ctx, configData): boolean {
    const { previousStatus, newStatus, sheet } = payloadOf(ctx);
    // Arrival semantics, same as the staff notifier: creates carry
    // previousStatus: null (never equal to a real status), so a sheet created
    // directly in a configured status fires; an edit that leaves the status
    // alone never does.
    if (!newStatus) return false;
    if (newStatus === previousStatus) return false;
    const triggers = new Set(configuredStatuses(configData));
    if (triggers.size === 0) return false;
    if (!triggers.has(newStatus)) return false;
    // Nothing left to accept on a day that has already happened, so a
    // past-dated sheet is never worth a text. See the plugin doc comment.
    return isNotifiableSheetYmd(sheet?.ymd);
  },

  async getRecipients(ctx): Promise<NotifierRecipient[]> {
    const { sheetId } = payloadOf(ctx);
    const { storage, createCommSmsOptinStorage } = await import(
      "../../../storage"
    );

    // Assignments already narrowed to workers with an active primary phone,
    // ordered by assignment id so a repeated worker always resolves to the
    // same assignment.
    const targets =
      await storage.edlsAssignments.getSmsTargetsBySheetId(sheetId);
    if (targets.length === 0) return [];

    // One entry per contact: a worker assigned twice on the same sheet is
    // texted once, about their first assignment on it.
    const firstByContact = new Map<string, (typeof targets)[number]>();
    for (const target of targets) {
      if (!firstByContact.has(target.contactId)) {
        firstByContact.set(target.contactId, target);
      }
    }

    // Drop anyone whose number has not recorded an SMS opt-in before the
    // sender turns them into a failed communication record.
    const optins = await createCommSmsOptinStorage().getSmsOptinsByPhoneNumbers(
      Array.from(firstByContact.values()).map((t) => t.phoneNumber),
    );

    const links = new Map<string, string>();
    const recipients: NotifierRecipient[] = [];
    for (const [contactId, target] of firstByContact) {
      if (!optins.get(target.phoneNumber)?.optin) continue;
      links.set(contactId, target.assignmentId);
      recipients.push({ contactId });
    }

    assignmentByContact.set(ctx, links);
    return recipients;
  },

  async getMessage(
    medium: NotificationMedium,
    recipient: NotifierRecipient,
    ctx: EventNotifierEventContext,
  ): Promise<NotifierMessageContent | null> {
    if (medium !== "sms") return null;
    const assignmentId = assignmentByContact.get(ctx)?.get(recipient.contactId);
    // No assignment resolved means this recipient did not come from the sheet
    // read above; there is no honest link to send them.
    if (!assignmentId) return null;
    return {
      message: `${SENTENCE} ${assignmentScheduleUrl(assignmentId)}`,
    };
  },

  /**
   * Record the text on the assignment it was about, so a sheet can show who
   * was contacted and what they were sent.
   *
   * Reuses the same per-event contact → assignment map the message was built
   * from, which is what makes the recorded link and the link inside the text
   * necessarily the same assignment.
   *
   * Deliberately records failures too: the framework calls this whenever a
   * comm record exists, and a worker whose text bounced is a more useful thing
   * to see on a sheet than one indistinguishable from a worker nobody tried to
   * reach. Workers with no active primary number and workers who never opted
   * in are filtered out before sending, so they are never recorded — they were
   * genuinely not contacted.
   */
  async onCommCreated(
    medium: NotificationMedium,
    recipient: NotifierRecipient,
    comm: Comm,
    ctx: EventNotifierEventContext,
  ): Promise<void> {
    if (medium !== "sms") return;
    const assignmentId = assignmentByContact.get(ctx)?.get(recipient.contactId);
    if (!assignmentId) return;
    const { storage } = await import("../../../storage");
    // A false return means there was nothing to record onto: the assignment
    // was deleted between the text going out and this write, or a later text
    // already claimed the slot. The worker was still texted either way, and
    // neither case is repairable here.
    await storage.edlsAssignments.setCommId(assignmentId, comm.id);
  },
};

registerEventNotifier(edlsSheetWorkerSmsNotifier);
