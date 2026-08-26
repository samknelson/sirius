import {
  EventType,
  type BaoCaseStatusSavedPayload,
} from "../../../services/event-bus";
import { registerEventNotifier } from "../registry";
import { templatesSchemaBlock } from "../template-schema";
import { BAO_CASE_ENTITY_KIND } from "../../tokens/plugins/sitespecific-bao-case";
import {
  type EventNotifierEventContext,
  type EventNotifierPlugin,
  type NotifierChannelTemplates,
} from "../types";

function payloadOf(ctx: EventNotifierEventContext): BaoCaseStatusSavedPayload {
  return ctx.payload as BaoCaseStatusSavedPayload;
}

/** Root name: the entity kind of the record the notice is about. */
const ROOT = BAO_CASE_ENTITY_KIND;

/** Read + normalize the admin's per-config settings off `data`. */
function configOf(configData: unknown): { statusIds: string[] } {
  const data =
    configData && typeof configData === "object"
      ? (configData as Record<string, unknown>)
      : {};
  return {
    statusIds: Array.isArray(data.statusIds)
      ? (data.statusIds as unknown[]).filter((v): v is string => typeof v === "string")
      : [],
  };
}

const TITLE = `BAO case - {{${ROOT}.field(name="status_name")}} - {{${ROOT}}}`;
const SENTENCE =
  `The BAO case for {{${ROOT}}} ` +
  `is now {{${ROOT}.field(name="status_name")}} ` +
  `(deadline {{${ROOT}.field(name="deadline_ymd")}}).`;
const LINK_URL = `{{${ROOT}.url}}`;
const LINK_PATH = `{{${ROOT}.path}}`;
const LINK_LABEL = "View Case";

/** Default per-channel templates, rendered against the committed case snapshot. */
function defaultTemplates(): NotifierChannelTemplates {
  return {
    email: {
      subject: TITLE,
      bodyHtml:
        `<p>${SENTENCE}</p>` +
        `<p><a href="${LINK_URL}">${LINK_LABEL}</a></p>`,
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
 * Notifies selected staff when a generic BAO case is created in — or
 * genuinely transitions into — one of the config's chosen statuses.
 *
 * `shouldDispatch` fires only when the committed status is one of the
 * configured statuses AND the write actually arrived there (creation
 * counts; a lifecycle save that leaves the status unchanged never fires;
 * legacy/incomplete emits without the snapshot fields are skipped).
 * The event payload carries the committed case row and event-time
 * display names, so later case edits cannot rewrite an earned message.
 */
export const baoCaseStatusNotifier: EventNotifierPlugin = {
  id: "bao_case_status",
  name: "BAO Case Status Notifier",
  description:
    "Notifies selected staff when a generic BAO case is created in or transitions into a chosen status.",
  order: 100,
  requiredComponent: "sitespecific.bao",
  // Staff-mode: recipients are the config's picked staff users, resolved by
  // the framework. Self-suppression stays on: the staff member who made the
  // change does not need to be told about it.
  staffNotification: true,
  subscribedEvents: [EventType.BAO_CASE_STATUS_SAVED],
  supportedMedia: ["inapp", "email", "sms"],
  configSchema: {
    type: "object",
    required: ["statusIds", "staffRecipientUserIds"],
    properties: {
      statusIds: {
        type: "array",
        title: "Case statuses",
        description:
          "Send a notification when a case is created in or transitions into one of these statuses.",
        items: { type: "string" },
        minItems: 1,
        uniqueItems: true,
        "x-options-resource": "bao-case-status",
      },
      staffRecipientUserIds: {
        type: "array",
        title: "Staff recipients",
        description: "Staff or admin users to notify.",
        items: { type: "string" },
        minItems: 1,
        "x-widget": "staff-recipients",
      },
      templates: templatesSchemaBlock({
        exampleTokens: [
          `{{${ROOT}.field(name="status_name")}}`,
          `{{${ROOT}.field(name="entity_name")}}`,
        ],
      }),
    },
  },

  tokenTemplates: {
    roots: [
      {
        name: ROOT,
        kind: BAO_CASE_ENTITY_KIND,
        label: "BAO case",
        description: "The BAO case this status event is about",
        async build(ctx) {
          const payload = payloadOf(ctx);
          if (!payload.row) return null;
          const { sitespecificBaoCases } = await import(
            "../../../../shared/schema/sitespecific/bao/schema"
          );
          // The committed case row carried on the event, plus the
          // event-time display names captured in the writing transaction.
          // Not reloaded by id: a later edit (or delete) must not rewrite
          // the message this transition earned.
          return {
            kind: BAO_CASE_ENTITY_KIND,
            row: {
              ...(payload.row as unknown as Record<string, unknown>),
              statusName: payload.statusName,
              entityName: payload.entityName,
            },
            table: sitespecificBaoCases,
          };
        },
      },
    ],
    defaultTemplates,
  },

  shouldDispatch(ctx, configData): boolean {
    const payload = payloadOf(ctx);
    // Legacy/incomplete emits without the snapshot or transition identity:
    // skip to be safe.
    if (!payload.row || !payload.statusId || payload.previousStatusId === undefined) {
      return false;
    }
    const { statusIds } = configOf(configData);
    if (statusIds.length === 0) return false;
    if (!statusIds.includes(payload.statusId)) return false;
    // Fire only when the write actually ARRIVED at the status: creation into
    // it (previousStatusId is null) or a genuine transition. Unrelated edits
    // that leave the status unchanged never fire.
    return payload.previousStatusId !== payload.statusId;
  },
};

registerEventNotifier(baoCaseStatusNotifier);
