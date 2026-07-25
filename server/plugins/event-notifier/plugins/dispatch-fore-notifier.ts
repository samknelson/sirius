import {
  EventType,
  type DispatchForeSavedPayload,
} from "../../../services/event-bus";
import { registerEventNotifier } from "../registry";
import {
  type EventNotifierEventContext,
  type EventNotifierPlugin,
  type NotificationMedium,
  type NotifierMessageContent,
  type NotifierRecipient,
} from "../types";

function payloadOf(ctx: EventNotifierEventContext): DispatchForeSavedPayload {
  return ctx.payload as DispatchForeSavedPayload;
}

/**
 * Absolute URL to the dispatch job. In-app messages navigate with a relative
 * path, but email/SMS leave the app so they need a fully-qualified link.
 * Mirrors the domain resolution used by the dispatch-status notifier.
 */
function absoluteJobUrl(jobId: string): string {
  const domain =
    process.env.REPLIT_DEV_DOMAIN ||
    process.env.REPLIT_DOMAINS?.split(",")[0] ||
    "localhost:5000";
  return `https://${domain}/dispatch/job/${jobId}`;
}

/**
 * Notifies a worker when they are added to or removed from a dispatch job's
 * Forepersons. `notifySelf: true` because the change is always made by staff
 * acting on the worker's behalf — if a staff member happens to also be the
 * worker, self-suppression would silently swallow the notification.
 */
export const dispatchForeNotifier: EventNotifierPlugin = {
  id: "dispatch-fore-notifier",
  name: "Dispatch Foreperson Notifier",
  description:
    "Notifies the worker when they are added to or removed from a dispatch job's Forepersons.",
  order: 100,
  requiredComponent: "dispatch.fore",
  notifySelf: true,
  subscribedEvents: [EventType.DISPATCH_FORE_SAVED],
  supportedMedia: ["inapp", "email", "sms"],

  async getRecipients(ctx): Promise<NotifierRecipient[]> {
    const { workerId } = payloadOf(ctx);
    if (!workerId) return [];
    const { storage } = await import("../../../storage");
    const worker = await storage.workers.getWorker(workerId);
    const contactId = worker?.contactId;
    if (!contactId) return [];
    return [{ contactId }];
  },

  async getMessage(
    medium: NotificationMedium,
    _recipient: NotifierRecipient,
    ctx: EventNotifierEventContext,
  ): Promise<NotifierMessageContent | null> {
    const { jobId, action, jobTitle, employerName } = payloadOf(ctx);
    const added = action === "added";
    const title = added ? "Added as Foreperson" : "Removed as Foreperson";
    const body = added
      ? `You have been added as a Foreperson on "${jobTitle}" at ${employerName}.`
      : `You have been removed as a Foreperson on "${jobTitle}" at ${employerName}.`;
    const linkUrl = `/dispatch/job/${jobId}`;
    const absoluteUrl = absoluteJobUrl(jobId);

    switch (medium) {
      case "inapp":
        return {
          title,
          body,
          linkUrl,
          linkLabel: "View Job",
        };
      case "email":
        return {
          subject: title,
          bodyText: `${body}\n\nView the job: ${absoluteUrl}`,
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

registerEventNotifier(dispatchForeNotifier);
