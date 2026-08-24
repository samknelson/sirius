import {
  EventType,
  type SitespecificT631InterviewSavedPayload,
} from "../../../services/event-bus";
import { registerEventNotifier } from "../registry";
import { resolveStaffRecipients } from "../dispatcher";
import {
  EMPLOYER_VISIBLE_STATUSES,
  type InterviewStatus,
} from "../../../modules/sitespecific/t631/interview-rules";
import { T631_INTERVIEW_ENTITY_KIND } from "../../tokens/plugins/sitespecific-t631-interview";
import { templatesSchemaBlock } from "../template-schema";
import {
  type EventNotifierEventContext,
  type EventNotifierPlugin,
  type NotifierChannelTemplates,
  type NotifierRecipient,
} from "../types";

const PLUGIN_ID = "sitespecific_t631_interview";

/** Root name the interview is seeded under in this notifier's templates. */
const ROOT = "sitespecific_t631_interview";

const STATUS_VALUES = ["offered", "accepted", "declined", "passed", "failed"] as const;

function payloadOf(ctx: EventNotifierEventContext): SitespecificT631InterviewSavedPayload {
  return ctx.payload as SitespecificT631InterviewSavedPayload;
}

/** Human label for an interview status value ("offered" → "Offered"). */
function statusLabel(status: string): string {
  if (!status) return status;
  return status.charAt(0).toUpperCase() + status.slice(1);
}

interface InterviewNotifierConfig {
  targetStatus: string;
  recipientKind: "worker" | "employer" | "staff";
  staffRecipientUserIds: string[];
}

/** Read + normalize the admin's per-config settings off `data`. */
function configOf(configData: unknown): InterviewNotifierConfig {
  const data =
    configData && typeof configData === "object"
      ? (configData as Record<string, unknown>)
      : {};
  const kind = data.recipientKind;
  return {
    targetStatus: typeof data.targetStatus === "string" ? data.targetStatus : "",
    recipientKind:
      kind === "worker" || kind === "employer" || kind === "staff" ? kind : "worker",
    staffRecipientUserIds: Array.isArray(data.staffRecipientUserIds)
      ? (data.staffRecipientUserIds as unknown[]).filter(
          (v): v is string => typeof v === "string",
        )
      : [],
  };
}

/**
 * The page a recipient is linked to, as a token template. Workers land
 * on their own interviews tab; employer contacts and staff land on the
 * job's interviews page — which is the interview's OWN declared
 * location, since an interview is listed on the job that holds it.
 *
 * Neither route is spelled here: each record says where it lives, `url`
 * is the absolute form for email/SMS and `path` the relative one the
 * in-app link wants.
 */
function linkPathTemplate(recipientKind: InterviewNotifierConfig["recipientKind"]): {
  url: string;
  path: string;
  label: string;
} {
  if (recipientKind === "worker") {
    return {
      url: `{{${ROOT}.worker.url(tab="dispatch-t631-interviews")}}`,
      path: `{{${ROOT}.worker.path(tab="dispatch-t631-interviews")}}`,
      label: "View Interview",
    };
  }
  return {
    url: `{{${ROOT}.url}}`,
    path: `{{${ROOT}.path}}`,
    label: "View Interviews",
  };
}

const SENTENCE =
  `The interview for {{${ROOT}.worker.contact}} ` +
  `on the job "{{${ROOT}.dispatch_job}}" ` +
  `is now {{${ROOT}}}.`;

/**
 * Subject/title: area, what happened, then the record that identifies it
 * to the reader. The job names the interview for every recipient kind —
 * a worker recipient already knows who they are, and a staff or employer
 * recipient is reading about that job. The new status is the sentence's
 * job, not the subject's.
 */
const TITLE = `Interview - status change - {{${ROOT}.dispatch_job}}`;

/** Default per-channel templates; the link target varies with the recipient kind. */
function defaultTemplates(configData?: unknown): NotifierChannelTemplates {
  const { url, path, label } = linkPathTemplate(
    configOf(configData).recipientKind,
  );
  return {
    email: {
      subject: TITLE,
      bodyHtml: `<p>${SENTENCE}</p>` + `<p><a href="${url}">${label}</a></p>`,
    },
    sms: {
      message: `${SENTENCE} View: ${url}`,
    },
    inapp: {
      title: TITLE,
      body: SENTENCE,
      linkUrl: path,
      linkLabel: label,
    },
  };
}

/**
 * Notifies configured recipients when a T631 job interview transitions INTO
 * the config's target status. Each config targets one status and one recipient
 * kind (the interview's worker, the job's associated employer contacts, or
 * specific staff users). Message content is composed by the framework from
 * token templates (`tokenTemplates`): the defaults above, overridden per
 * config via `data.templates`.
 *
 * `shouldDispatch` fires only on real transitions into the target status
 * (creation at that status counts; same-status re-saves and deletes never
 * fire; legacy emits without `previousStatus` are skipped to be safe).
 */
export const sitespecificT631InterviewNotifier: EventNotifierPlugin = {
  id: PLUGIN_ID,
  name: "T631 Interview Status Notifier",
  description:
    "Notifies the worker, the job's employer contacts, or selected staff when a job interview transitions into a chosen status.",
  order: 100,
  requiredComponent: "sitespecific.t631.interviews",
  subscribedEvents: [EventType.SITESPECIFIC_T631_INTERVIEW_SAVED],
  supportedMedia: ["email", "sms", "inapp"],
  configSchema: {
    type: "object",
    required: ["targetStatus", "recipientKind"],
    properties: {
      targetStatus: {
        type: "string",
        title: "Interview status",
        description:
          "Send a notification when an interview transitions into this status.",
        enum: [...STATUS_VALUES],
        enumNames: STATUS_VALUES.map(statusLabel),
      },
      recipientKind: {
        type: "string",
        title: "Recipient",
        description:
          "Who receives the notification: the interview's worker, all employer contacts associated with the job, or specific staff users.",
        enum: ["worker", "employer", "staff"],
        enumNames: ["Worker", "Employer contacts on the job", "Staff"],
      },
      staffRecipientUserIds: {
        type: "array",
        title: "Staff recipients",
        description:
          'Staff or admin users to notify. Only used when Recipient is "Staff".',
        items: { type: "string" },
        "x-widget": "staff-recipients",
      },
      // Per-channel message templates, from the shared framework builder.
      // The default link target varies with the recipient kind; the
      // editor sends the whole config with its catalog request, so the
      // defaults it shows follow that field without declaring it here.
      templates: templatesSchemaBlock({
        exampleTokens: [
          `{{${ROOT}.field(name="status")}}`,
          `{{${ROOT}.worker.contact.field(name="display_name")}}`,
        ],
      }),
    },
    // Employers only ever see interviews in EMPLOYER_VISIBLE_STATUSES (the
    // T631 routes hide the rest), so an employer-targeted config may not
    // reference a hidden status. Mirrored at runtime in shouldDispatch.
    allOf: [
      {
        if: { properties: { recipientKind: { enum: ["employer"] } } },
        then: {
          properties: {
            targetStatus: { enum: [...EMPLOYER_VISIBLE_STATUSES] },
          },
        },
      },
    ],
  },

  tokenTemplates: {
    roots: [
      {
        name: ROOT,
        kind: T631_INTERVIEW_ENTITY_KIND,
        label: "Interview",
        description: "The job interview whose status this event changed",
        async build(ctx) {
          const payload = payloadOf(ctx);
          const { storage } = await import("../../../storage");
          const { sitespecificT631JobInterviews } = await import(
            "../../../../shared/schema/sitespecific/t631/interviews-schema"
          );
          const row = await storage.t631Interviews.get(payload.interviewId);
          if (!row) return null;
          return {
            kind: T631_INTERVIEW_ENTITY_KIND,
            row: row as unknown as Record<string, unknown>,
            table: sitespecificT631JobInterviews,
          };
        },
      },
    ],
    defaultTemplates,
    // Real-record preview is provided by the generic token preview-entity
    // registry (registered alongside the interview token plugins).
  },

  shouldDispatch(ctx, configData): boolean {
    const { status, previousStatus, isDeleted } = payloadOf(ctx);
    if (isDeleted) return false;
    // Legacy emits without the transition fields: skip to be safe.
    if (previousStatus === undefined) return false;
    const { targetStatus, recipientKind } = configOf(configData);
    if (!targetStatus) return false;
    // Employers only ever see interviews in EMPLOYER_VISIBLE_STATUSES — the
    // T631 routes 404 other statuses to employer callers, and a notification
    // must not leak what the UI/API hides. Enforced here (runtime) and in the
    // config schema (save time); this guard also covers pre-existing configs.
    if (
      recipientKind === "employer" &&
      !EMPLOYER_VISIBLE_STATUSES.has(targetStatus as InterviewStatus)
    ) {
      return false;
    }
    // Fire only on a real transition INTO the target status (creation at the
    // target status counts: previousStatus is null ≠ status).
    return status === targetStatus && previousStatus !== status;
  },

  async getRecipients(ctx, configData): Promise<NotifierRecipient[]> {
    const payload = payloadOf(ctx);
    const cfg = configOf(configData);
    const { storage } = await import("../../../storage");

    if (cfg.recipientKind === "worker") {
      const worker = await storage.workers.getWorker(payload.workerId);
      if (!worker?.contactId) return [];
      // Resolve the worker's user (by contact email) so in-app delivery and
      // self-suppression can match them.
      const contact = await storage.contacts.getContact(worker.contactId);
      const user = contact?.email
        ? await storage.users.getUserByEmail(contact.email)
        : undefined;
      return [{ contactId: worker.contactId, userId: user?.id ?? null }];
    }

    if (cfg.recipientKind === "employer") {
      const associations = await storage.dispatchJobEmployerContacts.listByJob(
        payload.jobId,
      );
      const byContact = new Map<string, NotifierRecipient>();
      for (const assoc of associations) {
        const contactId = assoc.contact?.id;
        if (!contactId || byContact.has(contactId)) continue;
        const email = assoc.contact?.email;
        const user = email ? await storage.users.getUserByEmail(email) : undefined;
        byContact.set(contactId, { contactId, userId: user?.id ?? null });
      }
      return Array.from(byContact.values());
    }

    // staff: resolve the config's picked user ids the same way the framework's
    // staff-mode notifiers do (userId → user email → contact). This plugin
    // cannot use the global staff-notification mode because the recipient kind
    // is chosen per config. Dedupe by contact — duplicate ids in the config or
    // distinct users sharing a contact must not produce duplicate sends.
    const staff = await resolveStaffRecipients(
      Array.from(new Set(cfg.staffRecipientUserIds)),
      PLUGIN_ID,
    );
    const byContact = new Map<string, NotifierRecipient>();
    for (const r of staff) {
      if (!byContact.has(r.contactId)) byContact.set(r.contactId, r);
    }
    return Array.from(byContact.values());
  },
};

registerEventNotifier(sitespecificT631InterviewNotifier);
