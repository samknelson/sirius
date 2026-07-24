import {
  EventType,
  type DispatchStatusSavedPayload,
} from "../../../services/event-bus";
import { registerEventNotifier } from "../registry";
import {
  type EventNotifierEventContext,
  type EventNotifierPlugin,
  type NotificationMedium,
  type NotifierMessageContent,
  type NotifierRecipient,
} from "../types";

function payloadOf(ctx: EventNotifierEventContext): DispatchStatusSavedPayload {
  return ctx.payload as DispatchStatusSavedPayload;
}

/** Human label for a dispatch status value ("available" → "Available"). */
function statusLabel(status: string): string {
  switch (status) {
    case "available":
      return "Available";
    case "not_available":
      return "Not Available";
    default:
      return status;
  }
}

/**
 * Absolute URL to the worker's dispatch page. In-app messages navigate with a
 * relative path, but email/SMS leave the app so they need a fully-qualified
 * link. Mirrors the domain resolution used by the tos-absence notifier.
 */
function absoluteDispatchUrl(workerId: string): string {
  const domain =
    process.env.REPLIT_DEV_DOMAIN ||
    process.env.REPLIT_DOMAINS?.split(",")[0] ||
    "localhost:5000";
  return `https://${domain}/workers/${workerId}/dispatch/status`;
}

/**
 * Notifies a worker when their dispatch availability actually changes value —
 * whether the change was made by staff, by the worker, or automatically (e.g.
 * the Auto Sign-In denorm plugin or the primary-dispatch sign-out plugin).
 *
 * `shouldDispatch` skips deletes and saves that did not change the status
 * (the storage layer now carries `previousStatus` on the event for exactly
 * this comparison). `notifySelf: true` because automatic status changes run
 * in the context of whichever user triggered the dispatch action — often the
 * worker themself — and self-suppression would silently swallow those.
 */
export const dispatchStatusNotifier: EventNotifierPlugin = {
  id: "dispatch-status-notifier",
  name: "Dispatch Status Change Notifier",
  description:
    "Notifies the worker when their dispatch availability changes (Available / Not Available), including automatic changes such as auto sign-in.",
  order: 100,
  requiredComponent: "dispatch",
  notifySelf: true,
  subscribedEvents: [EventType.DISPATCH_STATUS_SAVED],
  supportedMedia: ["inapp", "email", "sms"],

  shouldDispatch(ctx): boolean {
    const { status, previousStatus, isDeleted } = payloadOf(ctx);
    if (isDeleted) return false;
    // Only notify on a real transition. previousStatus is null on create
    // (no prior row → the worker "arrives" at a status) and undefined only
    // for legacy emits that predate the field — skip those to be safe.
    if (previousStatus === undefined) return false;
    return previousStatus !== status;
  },

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
    const { workerId, status } = payloadOf(ctx);
    const label = statusLabel(status);
    const title = "Dispatch Status Changed";
    const body = `Your dispatch status is now ${label}.`;
    const linkUrl = `/workers/${workerId}/dispatch/status`;
    const absoluteUrl = absoluteDispatchUrl(workerId);

    switch (medium) {
      case "inapp":
        return {
          title,
          body,
          linkUrl,
          linkLabel: "View Dispatch",
        };
      case "email":
        return {
          subject: title,
          bodyText: `${body}\n\nView your dispatch page: ${absoluteUrl}`,
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

registerEventNotifier(dispatchStatusNotifier);
