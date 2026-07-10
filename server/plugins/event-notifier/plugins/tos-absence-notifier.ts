import {
  EventType,
  type TosAbsenceReminderPayload,
} from "../../../services/event-bus";
import { registerEventNotifier } from "../registry";
import {
  type EventNotifierEventContext,
  type EventNotifierPlugin,
  type NotificationMedium,
  type NotifierMessageContent,
  type NotifierRecipient,
} from "../types";

function payloadOf(ctx: EventNotifierEventContext): TosAbsenceReminderPayload {
  return ctx.payload as TosAbsenceReminderPayload;
}

/**
 * Absolute URL to the worker detail page. In-app messages navigate with a
 * relative path, but email/SMS leave the app so they need a fully-qualified
 * link. Mirrors the domain resolution used by the grievance notifiers.
 */
function absoluteWorkerUrl(workerId: string): string {
  const domain =
    process.env.REPLIT_DEV_DOMAIN ||
    process.env.REPLIT_DOMAINS?.split(",")[0] ||
    "localhost:5000";
  return `https://${domain}/workers/${workerId}`;
}

/**
 * Delivers a TOS/absence reminder when the generic EBS pump fires a scheduled
 * `TOS_ABSENCE_REMINDER` event (one per configured offset — default 1, 3, and
 * 11 days after the absence start). The event carries the worker's `contactId`
 * (the sole recipient); the dispatcher resolves the in-app `userId` from that
 * contact and drops the medium if there is no linked user. WHEN each reminder
 * fires is owned by the `tos_absence_reminder` denorm plugin's offsets, so this
 * notifier has no per-config gate or editable settings — it only shapes the
 * message and names the recipient.
 */
export const tosAbsenceNotifier: EventNotifierPlugin = {
  id: "tos-absence-notifier",
  name: "TOS Absence Reminder Notifier",
  description:
    "Notifies the worker's contact when a scheduled absence reminder falls due (a configurable number of days after the absence start).",
  order: 100,
  requiredComponent: "worker.tos",
  subscribedEvents: [EventType.TOS_ABSENCE_REMINDER],
  supportedMedia: ["inapp", "email", "sms"],

  async getRecipients(ctx): Promise<NotifierRecipient[]> {
    const { contactId } = payloadOf(ctx);
    if (!contactId) return [];
    return [{ contactId }];
  },

  async getMessage(
    medium: NotificationMedium,
    _recipient: NotifierRecipient,
    ctx: EventNotifierEventContext,
  ): Promise<NotifierMessageContent | null> {
    const { workerId, offset, absenceStartDate } = payloadOf(ctx);
    const dayWord = offset === 1 ? "day" : "days";
    const body = `It has been ${offset} ${dayWord} since an absence beginning ${absenceStartDate}.`;
    const title = "Absence Reminder";
    const linkUrl = `/workers/${workerId}`;
    const absoluteUrl = absoluteWorkerUrl(workerId);

    switch (medium) {
      case "inapp":
        return {
          title,
          body,
          linkUrl,
          linkLabel: "View Worker",
        };
      case "email":
        return {
          subject: title,
          bodyText: `${body}\n\nView the worker: ${absoluteUrl}`,
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

registerEventNotifier(tosAbsenceNotifier);
