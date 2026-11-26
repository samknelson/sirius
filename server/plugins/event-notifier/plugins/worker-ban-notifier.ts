import { escapeHtml } from "@shared/utils/html/escape";
import {
  EventType,
  type WorkerBanSavedPayload,
} from "../../../services/event-bus";
import { registerEventNotifier } from "../registry";
import type { EventNotifierEventContext, EventNotifierPlugin } from "../types";

function payloadOf(ctx: EventNotifierEventContext): WorkerBanSavedPayload {
  return ctx.payload as WorkerBanSavedPayload;
}

function formatDate(date: Date): string {
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export const workerBanNotifier: EventNotifierPlugin = {
  id: "worker-ban-notifier",
  name: "Worker Ban Notifier",
  description:
    "Notifies the affected worker whenever an active ban is saved. Create and enable a configuration to start delivery.",
  order: 100,
  requiredComponent: "worker.ban",
  // The legacy listener notified the worker regardless of who saved the ban.
  notifySelf: true,
  subscribedEvents: [EventType.WORKER_BAN_SAVED],
  supportedMedia: ["email", "sms", "inapp"],

  shouldDispatch(ctx) {
    const payload = payloadOf(ctx);
    return !payload.isDeleted && payload.active;
  },

  async getRecipients(ctx) {
    const { workerId } = payloadOf(ctx);
    if (!workerId) return [];
    const { storage } = await import("../../../storage");
    const worker = await storage.workers.getWorker(workerId);
    if (!worker?.contactId) return [];
    // Keep contacts without accounts eligible for email/SMS. The dispatcher
    // resolves addresses, phones and the linked in-app user for each medium.
    return [{ contactId: worker.contactId }];
  },

  async getMessage(medium, recipient, ctx) {
    const payload = payloadOf(ctx);
    // Describe the saved event, not a later version of the mutable ban row.
    const banType = payload.type
      ? payload.type.replace(/_/g, " ").toLowerCase()
      : "general";
    const startDate = formatDate(payload.startDate);
    const endDate = payload.endDate ? formatDate(payload.endDate) : null;
    const title = "Ban Notification";
    const message = endDate
      ? `A ${banType} ban has been applied to your account from ${startDate} to ${endDate}.`
      : `A ${banType} ban has been applied to your account starting ${startDate}.`;

    switch (medium) {
      case "sms":
        return { body: `${title}: ${message}` };
      case "inapp":
        return { title, body: message };
      case "email": {
        const { storage } = await import("../../../storage");
        const contact = await storage.contacts.getContact(recipient.contactId);
        if (!contact) return null;
        const workerName = contact.given || contact.displayName || "Worker";
        const closing = "If you have questions about this ban, please contact your administrator.";
        return {
          subject: title,
          bodyText: `Hello ${workerName},\n\n${message}\n\n${closing}`,
          bodyHtml: `<p>Hello ${escapeHtml(workerName)},</p><p>${escapeHtml(message)}</p><p>${closing}</p>`,
        };
      }
      default:
        return null;
    }
  },
};

registerEventNotifier(workerBanNotifier);
