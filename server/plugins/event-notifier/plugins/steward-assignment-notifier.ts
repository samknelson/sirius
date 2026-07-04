import { EventType, type StewardAssignmentSavedPayload } from "../../../services/event-bus";
import { registerEventNotifier } from "../registry";
import {
  type EventNotifierEventContext,
  type EventNotifierPlugin,
  type NotificationMedium,
  type NotifierMessageContent,
  type NotifierRecipient,
} from "../types";

/**
 * Human-readable body line for each operation. The "updated" wording is kept
 * identical to the legacy log-notifier so existing expectations don't change.
 */
function bodyFor(operation: StewardAssignmentSavedPayload["operation"]): string {
  switch (operation) {
    case "created":
      return "You have a new steward assignment.";
    case "deleted":
      return "A steward assignment has been removed.";
    case "updated":
    default:
      return "Your steward assignment has been updated.";
  }
}

function payloadOf(ctx: EventNotifierEventContext): StewardAssignmentSavedPayload {
  return ctx.payload as StewardAssignmentSavedPayload;
}

/**
 * Notifies a worker when their steward assignment is created, updated, or
 * deleted. Replaces the bespoke `log-notifier` reaction: the assignment storage
 * now emits `STEWARD_ASSIGNMENT_SAVED` and this plugin fans it out through the
 * generic event-notifier framework, so the admin picks the active media per
 * config instead of the channel being hard-coded to in-app.
 */
export const stewardAssignmentNotifier: EventNotifierPlugin = {
  id: "steward-assignment-notifier",
  name: "Steward Assignment Notifier",
  description:
    "Notifies a worker when their steward assignment is created, updated, or removed.",
  order: 100,
  requiredComponent: "worker.steward",
  subscribedEvents: [EventType.STEWARD_ASSIGNMENT_SAVED],
  supportedMedia: ["email", "sms", "inapp", "postal"],

  async getRecipients(ctx): Promise<NotifierRecipient[]> {
    const { workerId } = payloadOf(ctx);
    if (!workerId) return [];
    const { storage } = await import("../../../storage");
    const worker = await storage.workers.getWorker(workerId);
    if (!worker?.contactId) return [];
    return [{ contactId: worker.contactId }];
  },

  async getMessage(
    medium: NotificationMedium,
    recipient: NotifierRecipient,
    ctx: EventNotifierEventContext,
  ): Promise<NotifierMessageContent | null> {
    const { workerId, operation } = payloadOf(ctx);
    const title = "Steward Assignment Update";
    const body = bodyFor(operation);
    const linkUrl = `/workers/${workerId}/union/steward`;

    switch (medium) {
      case "inapp":
        return {
          title,
          body,
          linkUrl,
          linkLabel: "View Stewards",
        };
      case "email":
        return {
          subject: title,
          bodyText: body,
        };
      case "sms":
        return {
          message: body,
        };
      case "postal": {
        // Compose a basic letter as HTML (the postal sender stores this as the
        // letter body and the configured provider renders it). Greet the
        // recipient by name when their contact has one on file.
        const greeting = await greetingFor(recipient.contactId);
        return {
          file: postalLetterHtml(greeting, body),
          description: title,
        };
      }
      default:
        return null;
    }
  },
};

/** Resolve a "Dear <name>," greeting from the recipient's contact, if any. */
async function greetingFor(contactId: string): Promise<string> {
  try {
    const { storage } = await import("../../../storage");
    const contact = await storage.contacts.getContact(contactId);
    const name = contact?.displayName?.trim();
    return name ? `Dear ${name},` : "Dear Member,";
  } catch {
    return "Dear Member,";
  }
}

/** Minimal, self-contained HTML letter body for a steward-assignment notice. */
function postalLetterHtml(greeting: string, body: string): string {
  return [
    "<html><body style=\"font-family: Arial, sans-serif; font-size: 12pt; line-height: 1.5;\">",
    `<p>${greeting}</p>`,
    `<p>${body}</p>`,
    "<p>Please contact your union representative if you have any questions about your steward assignment.</p>",
    "<p>Sincerely,<br/>Your Union</p>",
    "</body></html>",
  ].join("");
}

registerEventNotifier(stewardAssignmentNotifier);
