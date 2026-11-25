import { cardcheckTokenRow, type CardcheckStatusChangePayload } from "@shared/cardcheck-notification";
import { EventType } from "../../../services/event-bus";
import { registerEventNotifier } from "../registry";
import { templatesSchemaBlock } from "../template-schema";
import type { EventNotifierPlugin } from "../types";

const NAME = '{{cardcheck.field(name="type")}}';
const STATUS = '{{cardcheck.field(name="status")}}';
const TITLE = `Card Check Status Change - ${STATUS}`;
const BODY = `Your "${NAME}" card check is now ${STATUS}. If you have questions, please contact your administrator.`;
const statuses = ["pending", "signed", "revoked"];

export const cardcheckStatusNotifier: EventNotifierPlugin = {
  id: "cardcheck-status-notifier",
  name: "Cardcheck Status Change Notifier",
  description: "Notifies the affected worker when an existing cardcheck changes to the selected status.",
  requiredComponent: "cardcheck",
  notifySelf: true,
  subscribedEvents: [EventType.CARDCHECK_STATUS_CHANGE_AFTER],
  supportedMedia: ["email", "inapp"],
  configSchema: {
    type: "object",
    required: ["destinationStatus"],
    properties: {
      destinationStatus: {
        type: "string",
        title: "Destination status",
        oneOf: [
          { enum: ["pending"], title: "Pending" },
          { enum: ["signed"], title: "Signed" },
          { enum: ["revoked"], title: "Revoked" },
        ],
      },
      templates: templatesSchemaBlock({
        exampleTokens: [NAME, STATUS, "{{cardcheck.path}}"],
      }),
    },
  },
  shouldDispatch(ctx, configData) {
    const destination = (configData as { destinationStatus?: unknown } | null)?.destinationStatus;
    const payload = ctx.payload as CardcheckStatusChangePayload | undefined;
    return ctx.event === EventType.CARDCHECK_STATUS_CHANGE_AFTER &&
      typeof destination === "string" && statuses.includes(destination) &&
      !!payload?.cardcheckId && !!payload.workerId &&
      statuses.includes(payload.previousStatus) &&
      payload.previousStatus !== payload.newStatus && payload.newStatus === destination &&
      payload.cardcheck?.id === payload.cardcheckId &&
      payload.cardcheck.workerId === payload.workerId &&
      payload.cardcheck.status === payload.newStatus;
  },
  async getRecipients(ctx) {
    const { workerId } = ctx.payload as CardcheckStatusChangePayload;
    const { storage } = await import("../../../storage");
    const worker = await storage.workers.getWorker(workerId);
    if (!worker?.contactId) return [];
    const contact = await storage.contacts.getContact(worker.contactId);
    if (!contact) return [];
    const user = contact.email ? await storage.users.getUserByEmail(contact.email) : undefined;
    return [{ contactId: contact.id, userId: user?.id }];
  },
  tokenTemplates: {
    roots: [{
      name: "cardcheck",
      kind: "cardcheck",
      label: "Cardcheck",
      description: "The exact cardcheck and status captured by this change",
      async build(ctx) {
        const payload = ctx.payload as CardcheckStatusChangePayload;
        if (!payload.cardcheck) return null;
        return { kind: "cardcheck", row: cardcheckTokenRow(payload.cardcheck) };
      },
    }],
    defaultTemplates() {
      return {
        email: { subject: TITLE, bodyHtml: `<p>${BODY}</p>` },
        inapp: {
          title: TITLE,
          body: BODY,
          linkUrl: "{{cardcheck.path}}",
          linkLabel: "View Card Checks",
        },
      };
    },
  },
};

registerEventNotifier(cardcheckStatusNotifier);
