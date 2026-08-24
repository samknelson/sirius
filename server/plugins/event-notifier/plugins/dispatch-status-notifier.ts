import {
  EventType,
  type DispatchStatusSavedPayload,
} from "../../../services/event-bus";
import { registerEventNotifier } from "../registry";
import { templatesSchemaBlock } from "../template-schema";
import {
  type EventNotifierEventContext,
  type EventNotifierPlugin,
  type NotifierChannelTemplates,
  type NotifierRecipient,
} from "../types";

function payloadOf(ctx: EventNotifierEventContext): DispatchStatusSavedPayload {
  return ctx.payload as DispatchStatusSavedPayload;
}

/** Root name: the entity kind of the record the notice is about. */
const ROOT = "dispatch_worker_status";

/** Display label for a dispatch status value ("available" → "Available").
 * A derived field of the availability row itself, declared on the
 * `dispatch_worker_status` descriptor so EVERY surface that builds one —
 * this notifier, the preview provider, the personas — carries it. */
export function dispatchStatusLabel(status: string): string {
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
 * Default per-channel templates, rendered against the worker's real
 * availability row (the one the event names).
 */
const TITLE = `Dispatch - status change - {{${ROOT}}}`;
const SENTENCE = `Your dispatch status is now {{${ROOT}}}.`;
// The availability row has no page of its own, but it declares WHERE it
// is shown — the worker's dispatch status tab, reached through the row's
// own worker_id column, so there is still no relation to come up empty.
const LINK_URL = `{{${ROOT}.url}}`;
const LINK_PATH = `{{${ROOT}.path}}`;
const LINK_LABEL = "View Dispatch";

function defaultTemplates(): NotifierChannelTemplates {
  return {
    email: {
      subject: TITLE,
      bodyHtml:
        `<p>${SENTENCE}<br><br>` +
        `View your dispatch page: ` +
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
  configSchema: {
    type: "object",
    properties: {
      templates: templatesSchemaBlock({
        exampleTokens: [
          `{{${ROOT}.field(name="status")}}`,
          `{{${ROOT}.worker.contact.field(name="display_name")}}`,
        ],
      }),
    },
  },

  tokenTemplates: {
    roots: [
      {
        name: ROOT,
        kind: "dispatch_worker_status",
        label: "Dispatch status",
        description: "The worker's dispatch availability row this event changed",
        async build(ctx) {
          const { row } = payloadOf(ctx);
          if (!row) return null;
          const { workerDispatchStatus } = await import(
            "../../../../shared/schema/dispatch/schema"
          );
          // The whole availability row as this write left it, carried on
          // the event, so every column the editor offers is genuinely
          // there. Not reloaded by id: the row is mutable, so a later
          // write would rewrite the message this transition earned — and a
          // deletion right after would swallow it.
          return {
            kind: "dispatch_worker_status",
            row: {
              ...(row as unknown as Record<string, unknown>),
              statusLabel: dispatchStatusLabel(row.status),
            },
            table: workerDispatchStatus,
          };
        },
      },
    ],
    defaultTemplates,
  },

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
};

registerEventNotifier(dispatchStatusNotifier);
