import {
  EventType,
  type BaoCaseStatusSavedPayload,
} from "../../../services/event-bus";
import { registerEventNotifier } from "../registry";
import { templatesSchemaBlock } from "../template-schema";
import { BAO_CASE_ENTITY_KIND } from "../../tokens/plugins/sitespecific-bao-case";
import { BAO_APPEAL_ENTITY_KIND } from "../../tokens/plugins/sitespecific-bao-appeal";
import {
  type EventNotifierEventContext,
  type EventNotifierPlugin,
  type NotifierChannelTemplates,
  type NotifierRecipient,
} from "../types";
import { buildBaoCaseRecord, statusEntry } from "./bao-case-record";

function payloadOf(ctx: EventNotifierEventContext): BaoCaseStatusSavedPayload {
  return ctx.payload as BaoCaseStatusSavedPayload;
}

/** Root names: the entity kinds of the records a letter is about. */
const CASE = BAO_CASE_ENTITY_KIND;
const APPEAL = BAO_APPEAL_ENTITY_KIND;

export const BAO_CASE_MEMBER_NOTICE_ID = "bao_case_member_notice";

interface MemberNoticeConfig {
  statusIds: string[];
}

/** Read + normalize the admin's per-config settings off `data`. */
function configOf(configData: unknown): MemberNoticeConfig {
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

/**
 * Send-once key for one letter: this case, entering this status. A case
 * can only enter a status once per transition, and the fund's letters are
 * per milestone (denied, approved, appeal denied), so a repeated emit for
 * the same entry — a retried save, a replayed event — must not mail a
 * second copy. The send layer scopes the key to medium + contact, so the
 * letter and its optional email copy each go out once.
 */
export function memberNoticeSendKey(payload: Pick<BaoCaseStatusSavedPayload, "caseId" | "statusId">): string {
  return `${BAO_CASE_MEMBER_NOTICE_ID}:${payload.caseId}:${payload.statusId}`;
}

const GREETING = `<p>Dear {{contact}},</p>`;
const SUBJECT_LINE =
  `<p><strong>Re: Your benefit appeal — {{${APPEAL}.field(name="benefit_name")}}</strong></p>`;
const STATUS_PARAGRAPH =
  `<p>This letter is to inform you that the status of your appeal regarding your ` +
  `{{${APPEAL}.field(name="benefit_name")}} benefits is now ` +
  `<strong>{{${CASE}.field(name="status_name")}}</strong>.</p>`;
const DETERMINATION_PARAGRAPH =
  `<p>The original determination was based on the following: ` +
  `{{${APPEAL}.field(name="denial_reason_name")}}. ` +
  `The applicable plan provision is {{${APPEAL}.field(name="spd_citation")}}.</p>`;
const DEADLINE_PARAGRAPH =
  `<p>If a response is required from you, it must be received by ` +
  `<strong>{{${CASE}.field(name="deadline_ymd")}}</strong>.</p>`;
const CLOSING =
  `<p>If you have questions about this letter, please contact the Benefits Administration Office.</p>` +
  `<p>Sincerely,<br>Benefits Administration Office</p>`;

const LETTER_BODY =
  GREETING + SUBJECT_LINE + STATUS_PARAGRAPH + DETERMINATION_PARAGRAPH + DEADLINE_PARAGRAPH + CLOSING;

/**
 * Default per-channel templates. One letter shape serves every milestone
 * (benefit denial, approval, denial of appeal): it names the benefit, the
 * status entered, the original denial reason with its SPD citation and the
 * response deadline, all from the committed case and its appeal. The fund
 * supplies the final wording per configuration in the studio.
 */
function defaultTemplates(): NotifierChannelTemplates {
  return {
    postal: {
      bodyHtml: LETTER_BODY,
      description:
        `Benefit appeal letter — {{${CASE}.field(name="status_name")}} — {{contact}}`,
    },
    email: {
      subject: `Your benefit appeal — {{${CASE}.field(name="status_name")}}`,
      bodyHtml: LETTER_BODY,
    },
  };
}

/**
 * Mails the member a templated letter when their case enters a configured
 * status: the benefit denial on Auto-Denied, the approval on Approved, the
 * denial of appeal on Closed–Denied — one configuration per letter, each
 * choosing the status(es) it fires on. Postal is the letter; email is an
 * optional second medium carrying the same body.
 *
 * Recipient: the worker the case is about (their contact). Cases about an
 * employer or a provider have no member to write to and send nothing.
 *
 * Messages are composed by the framework from the token templates against
 * the committed case snapshot on the event plus the appeal behind the case
 * (benefit, denial reason, SPD citation), read at send time; the appeal root
 * is optional so a non-appeal case still gets its letter with those tokens
 * at their defaults. Each letter goes out at most once per case + status
 * entry (send-once key); a failed send is recorded on the comm, not retried.
 * Every comm the send layer hands back is linked to the case as its letter
 * record, so case detail can show what went out and when.
 */
export const baoCaseMemberNotice: EventNotifierPlugin = {
  id: BAO_CASE_MEMBER_NOTICE_ID,
  name: "BAO Case Member Notice",
  description:
    "Mails the member (the case's worker) a templated letter — with an optional email copy — when their case enters a chosen status.",
  order: 105,
  requiredComponent: "sitespecific.bao",
  subscribedEvents: [EventType.BAO_CASE_STATUS_SAVED],
  supportedMedia: ["postal", "email"],
  configSchema: {
    type: "object",
    properties: {
      statusIds: {
        type: "array",
        title: "Send when the case enters",
        description:
          "The letter goes out when a case is created in or transitions into one of these statuses. " +
          "Create one configuration per letter (e.g. Auto-Denied → benefit denial letter, Approved → approval letter, Closed–Denied → denial of appeal).",
        items: { type: "string" },
        uniqueItems: true,
        "x-options-resource": "bao-case-status",
        "x-options-group-by": "caseTypeId",
        "x-options-group-resource": "bao-case-type",
      },
      templates: templatesSchemaBlock({
        exampleTokens: [
          `{{contact}}`,
          `{{${APPEAL}.field(name="benefit_name")}}`,
          `{{${APPEAL}.field(name="denial_reason_name")}}`,
          `{{${APPEAL}.field(name="spd_citation")}}`,
          `{{${CASE}.field(name="status_name")}}`,
          `{{${CASE}.field(name="deadline_ymd")}}`,
        ],
      }),
    },
  },

  // A configuration that names no status can never fire: refuse to save it
  // dead rather than leave the admin wondering why no letter went out.
  validateConfigData(configData) {
    const cfg = configOf(configData);
    if (cfg.statusIds.length === 0) {
      return {
        valid: false,
        errors: ["Choose at least one case status for this letter to be sent on."],
      };
    }
    return { valid: true };
  },

  tokenTemplates: {
    roots: [
      {
        name: CASE,
        kind: BAO_CASE_ENTITY_KIND,
        label: "BAO case",
        description: "The case this letter is about",
        build: async (ctx) => buildBaoCaseRecord(payloadOf(ctx)),
      },
      {
        name: APPEAL,
        kind: BAO_APPEAL_ENTITY_KIND,
        label: "Benefit appeal",
        description:
          "The appeal behind the case: the benefit appealed, the denial reason and its SPD citation",
        // Read at send time, after the writing transaction committed: the
        // appeal row is immutable once created and the benefit/reason names
        // are the live option names, which is what the letter should quote.
        async build(ctx) {
          const { caseId } = payloadOf(ctx);
          if (!caseId) return null;
          const { storage } = await import("../../../storage");
          const appeal = await storage.baoCases.getAppeal({ caseId });
          if (!appeal) return null;
          const { sitespecificBaoAppealDetails } = await import(
            "../../../../shared/schema/sitespecific/bao/schema"
          );
          return {
            kind: BAO_APPEAL_ENTITY_KIND,
            row: appeal as unknown as Record<string, unknown>,
            table: sitespecificBaoAppealDetails,
          };
        },
        // A case of another type has no appeal; its letter still goes out
        // with the appeal tokens at their defaults.
        optional: true,
      },
    ],
    defaultTemplates,
    sendKey: (ctx) => memberNoticeSendKey(payloadOf(ctx)),
  },

  shouldDispatch(ctx, configData): boolean {
    const payload = payloadOf(ctx);
    // Legacy/incomplete emits without the snapshot or transition identity:
    // skip to be safe.
    if (!payload.row || !payload.statusId || payload.previousStatusId === undefined) {
      return false;
    }
    return statusEntry(payload, configOf(configData).statusIds);
  },

  // The member: the worker the case is about, reached through their contact.
  async getRecipients(ctx): Promise<NotifierRecipient[]> {
    const payload = payloadOf(ctx);
    if (payload.entityType !== "worker" || !payload.entityId) return [];
    const { storage } = await import("../../../storage");
    const worker = await storage.workers.getWorker(payload.entityId);
    if (!worker?.contactId) return [];
    return [{ contactId: worker.contactId }];
  },

  // Every comm the send layer handed back — including a recorded failure —
  // is this case's letter record for the status entry that earned it.
  async onCommCreated(_medium, _recipient, comm, ctx) {
    const payload = payloadOf(ctx);
    const { storage } = await import("../../../storage");
    await storage.baoCases.linkComm({
      caseId: payload.caseId,
      commId: comm.id,
      statusId: payload.statusId ?? null,
      statusName: payload.statusName ?? null,
    });
  },
};

registerEventNotifier(baoCaseMemberNotice);
