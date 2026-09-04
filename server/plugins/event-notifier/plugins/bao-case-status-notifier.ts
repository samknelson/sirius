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
import {
  assignmentChange,
  buildBaoCaseRecord,
  statusEntry as arrivedAt,
} from "./bao-case-record";

function payloadOf(ctx: EventNotifierEventContext): BaoCaseStatusSavedPayload {
  return ctx.payload as BaoCaseStatusSavedPayload;
}

/** Root name: the entity kind of the record the notice is about. */
const ROOT = BAO_CASE_ENTITY_KIND;

interface BaoCaseNotifierConfig {
  statusIds: string[];
  staffRecipientUserIds: string[];
  notifyCurrentAssignee: boolean;
  /** Absent field defaults to true: existing configs keep self-suppression. */
  suppressActorNotification: boolean;
}

/** Read + normalize the admin's per-config settings off `data`. */
function configOf(configData: unknown): BaoCaseNotifierConfig {
  const data =
    configData && typeof configData === "object"
      ? (configData as Record<string, unknown>)
      : {};
  return {
    statusIds: Array.isArray(data.statusIds)
      ? (data.statusIds as unknown[]).filter((v): v is string => typeof v === "string")
      : [],
    staffRecipientUserIds: Array.isArray(data.staffRecipientUserIds)
      ? (data.staffRecipientUserIds as unknown[]).filter(
          (v): v is string => typeof v === "string",
        )
      : [],
    notifyCurrentAssignee: data.notifyCurrentAssignee === true,
    suppressActorNotification: data.suppressActorNotification !== false,
  };
}

/** Did this committed write ARRIVE at one of the configured statuses? */
function statusEntry(payload: BaoCaseStatusSavedPayload, cfg: BaoCaseNotifierConfig): boolean {
  return arrivedAt(payload, cfg.statusIds);
}
const TITLE = `BAO case {{${ROOT}.field(name="change_summary")}} - {{${ROOT}}}`;
const SENTENCE =
  `The BAO case for {{${ROOT}}} ` +
  `{{${ROOT}.field(name="change_summary")}} ` +
  `(status {{${ROOT}.field(name="status_name")}}, ` +
  `deadline {{${ROOT}.field(name="deadline_ymd")}}).`;
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
 * Notifies staff about committed BAO case writes. Two triggers, each gated
 * by the config:
 *   - STATUS ENTRY: the case was created in — or genuinely transitioned
 *     into — one of the config's chosen statuses. Recipients: the explicit
 *     staff list, plus the current assignee when that mode is enabled.
 *   - ASSIGNMENT CHANGE: `notifyCurrentAssignee` is enabled and the write
 *     genuinely changed the assignee (creation counts), even when the
 *     status did not move. Recipient: the committed NEW assignee only —
 *     the explicit list is not spammed for reassignments.
 *
 * Recipient decisions read only the committed event payload (case row,
 * previous/current assignee, effective actor captured by the write), so a
 * rolled-back write sends nothing and later edits cannot rewrite a message.
 * Per-config `suppressActorNotification` (default ON, preserving historic
 * behavior) drops the payload's effective actor from the recipients:
 * creating or taking your own case stays silent, while being assigned by
 * somebody else always notifies.
 */
export const baoCaseStatusNotifier: EventNotifierPlugin = {
  id: "bao_case_status",
  name: "BAO Case Status Notifier",
  description:
    "Notifies selected staff and/or the current assignee when a generic BAO case enters a chosen status or is reassigned.",
  order: 100,
  requiredComponent: "sitespecific.bao",
  // Staff-mode: the framework resolves recipients from user ids; the hook
  // below merges the committed current assignee into (or substitutes it for)
  // the config's explicit list depending on which trigger fired.
  staffNotification: true,
  subscribedEvents: [EventType.BAO_CASE_STATUS_SAVED],
  supportedMedia: ["inapp", "email", "sms"],
  configSchema: {
    type: "object",
    properties: {
      statusIds: {
        type: "array",
        title: "Case statuses",
        description:
          "Send a notification when a case is created in or transitions into one of these statuses. " +
          "May be left empty for an assignment-only notifier (requires Current Assignee below).",
        items: { type: "string" },
        uniqueItems: true,
        "x-options-resource": "bao-case-status",
      },
      notifyCurrentAssignee: {
        type: "boolean",
        title: "Notify the current assignee",
        description:
          "Dynamically notify the case's committed assignee: on entry into a chosen status, and whenever the case is genuinely reassigned (even without a status change).",
        default: false,
      },
      staffRecipientUserIds: {
        type: "array",
        title: "Staff recipients",
        description:
          "Explicit staff or admin users to notify on status entry. Saved as specific users — the role filter in the picker only narrows the candidate list.",
        items: { type: "string" },
        "x-widget": "staff-recipients",
      },
      suppressActorNotification: {
        type: "boolean",
        title: "Don't notify the user who made the change",
        description:
          "Skip delivery to the effective user who performed the update (e.g. taking one's own case). Being assigned by another user still notifies.",
        default: true,
      },
      templates: templatesSchemaBlock({
        exampleTokens: [
          `{{${ROOT}.field(name="status_name")}}`,
          `{{${ROOT}.field(name="entity_name")}}`,
          `{{${ROOT}.field(name="assignee_name")}}`,
          `{{${ROOT}.field(name="change_summary")}}`,
        ],
      }),
    },
  },

  // Cross-field rules the JSON schema cannot express without an RJSF-hostile
  // root anyOf: every config must have a usable recipient mode, and a config
  // that can never fire is refused rather than saved dead.
  validateConfigData(configData) {
    const cfg = configOf(configData);
    const errors: string[] = [];
    if (cfg.staffRecipientUserIds.length === 0 && !cfg.notifyCurrentAssignee) {
      errors.push(
        "Choose at least one recipient mode: select explicit staff recipients and/or enable “Notify the current assignee”.",
      );
    }
    if (cfg.statusIds.length === 0 && !cfg.notifyCurrentAssignee) {
      errors.push(
        "This configuration would never send: choose at least one case status, or enable “Notify the current assignee” for assignment notifications.",
      );
    }
    if (cfg.statusIds.length === 0 && cfg.staffRecipientUserIds.length > 0 && cfg.notifyCurrentAssignee) {
      errors.push(
        "Explicit staff recipients are only notified on status entry — choose at least one case status, or remove the explicit recipients for an assignment-only notifier.",
      );
    }
    return errors.length > 0 ? { valid: false, errors } : { valid: true };
  },

  tokenTemplates: {
    roots: [
      {
        name: ROOT,
        kind: BAO_CASE_ENTITY_KIND,
        label: "BAO case",
        description: "The BAO case this status event is about",
        // The committed row + event-time names, never a reload: see
        // buildBaoCaseRecord.
        build: async (ctx) => buildBaoCaseRecord(payloadOf(ctx)),
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
    const cfg = configOf(configData);
    if (statusEntry(payload, cfg)) return true;
    return cfg.notifyCurrentAssignee && assignmentChange(payload);
  },

  // Final recipient list for one dispatch: which trigger(s) fired decides
  // who is included; the dispatcher deduplicates, so an assignee who is also
  // explicitly selected gets exactly one delivery.
  resolveStaffRecipientUserIds(ctx, configData, configuredUserIds): string[] {
    const payload = payloadOf(ctx);
    const cfg = configOf(configData);
    const ids = new Set<string>();
    if (statusEntry(payload, cfg)) {
      for (const id of configuredUserIds) ids.add(id);
      if (cfg.notifyCurrentAssignee && payload.assigneeUserId) {
        ids.add(payload.assigneeUserId);
      }
    }
    if (cfg.notifyCurrentAssignee && assignmentChange(payload) && payload.assigneeUserId) {
      ids.add(payload.assigneeUserId);
    }
    return Array.from(ids);
  },

  // Per-config self-suppression, matched against the effective actor the
  // committed write captured (masquerade-aware; independent of the ambient
  // request context, which deferred deliveries lack).
  actorSuppression(ctx, configData) {
    const cfg = configOf(configData);
    return {
      suppress: cfg.suppressActorNotification,
      actorUserId: payloadOf(ctx).actorUserId ?? null,
    };
  },
};

registerEventNotifier(baoCaseStatusNotifier);
