import {
  EventType,
  type TrustElectionSavedPayload,
} from "../../../services/event-bus";
import { ENROLLMENT_TYPES, type EnrollmentType } from "@shared/schema";
import { registerEventNotifier } from "../registry";
import {
  type EventNotifierEventContext,
  type EventNotifierPlugin,
  type NotificationMedium,
  type NotifierMessageContent,
  type NotifierRecipient,
} from "../types";

function payloadOf(ctx: EventNotifierEventContext): TrustElectionSavedPayload {
  return ctx.payload as TrustElectionSavedPayload;
}

/** Human-readable label for each enrollment stream. */
const ENROLLMENT_TYPE_LABELS: Record<EnrollmentType, string> = {
  first_time: "First-Time Enrollment",
  life_event: "Life Event Change",
  open_enrollment: "Open Enrollment Change",
  cobra: "COBRA Enrollment",
};

/**
 * Read the single enrollment type this config routes for. A config that names
 * no (or an unknown) type routes nothing — `shouldDispatch` returns false — so
 * a misconfigured config never fires on every enrollment.
 */
function configuredEnrollmentType(configData: unknown): EnrollmentType | null {
  const data =
    configData && typeof configData === "object"
      ? (configData as Record<string, unknown>)
      : {};
  const value = data.enrollmentType;
  return ENROLLMENT_TYPES.includes(value as EnrollmentType)
    ? (value as EnrollmentType)
    : null;
}

/** Read the admin-selected staff recipient user ids off a config's `data`. */
function configuredRecipientUserIds(configData: unknown): string[] {
  const data =
    configData && typeof configData === "object"
      ? (configData as Record<string, unknown>)
      : {};
  const ids = data.staffRecipientUserIds;
  if (!Array.isArray(ids)) return [];
  return ids.filter((v): v is string => typeof v === "string");
}

/** Human-readable verb for each operation. */
function operationVerb(operation: TrustElectionSavedPayload["operation"]): string {
  switch (operation) {
    case "created":
      return "submitted";
    case "deleted":
      return "removed";
    case "updated":
    default:
      return "updated";
  }
}

/**
 * Absolute URL to the enrollment review queue for a type. In-app messages
 * navigate with a relative path, but email/SMS leave the app so they need a
 * fully-qualified link.
 */
function absoluteQueueUrl(type: EnrollmentType): string {
  const domain =
    process.env.REPLIT_DEV_DOMAIN ||
    process.env.REPLIT_DOMAINS?.split(",")[0] ||
    "localhost:5000";
  return `https://${domain}/trust/enrollment-queue?type=${type}`;
}

/**
 * Notifies selected staff when a benefit enrollment (worker trust election) is
 * submitted, updated, or removed. Each config routes exactly one enrollment
 * type (first-time / life event / open enrollment), so an admin creates one
 * config per stream — each with its own recipients, media, and message. The
 * per-config `shouldDispatch` gate drops events whose type does not match the
 * config, giving per-type notifications from a single plugin.
 *
 * WHO is notified is the required `staffRecipientUserIds` list; getRecipients
 * resolves each to the contact that owns its email (that contact anchors every
 * send + opt-out) and keeps the userId for in-app delivery. The user who
 * performed the action is dropped by the dispatcher's self-notification
 * suppression.
 */
export const trustElectionEnrollmentNotifier: EventNotifierPlugin = {
  id: "trust-election-enrollment",
  name: "Enrollment Notifier",
  description:
    "Notifies selected staff when a benefit enrollment of the chosen type is submitted, updated, or removed.",
  order: 100,
  requiredComponent: "trust.elections",
  subscribedEvents: [EventType.TRUST_ELECTION_SAVED],
  supportedMedia: ["inapp", "email", "sms"],
  configSchema: {
    type: "object",
    required: ["enrollmentType", "staffRecipientUserIds"],
    properties: {
      enrollmentType: {
        type: "string",
        title: "Enrollment type",
        description:
          "Only enrollments of this type trigger this notification. Create one config per type to route each stream differently.",
        enum: [...ENROLLMENT_TYPES],
        enumNames: ENROLLMENT_TYPES.map((t) => ENROLLMENT_TYPE_LABELS[t]),
      },
      staffRecipientUserIds: {
        type: "array",
        title: "Recipients",
        description:
          "Staff or admin users who receive a notification when a matching enrollment is saved. At least one is required.",
        minItems: 1,
        items: { type: "string" },
        "x-widget": "staff-recipients",
      },
    },
  },

  shouldDispatch(ctx, configData): boolean {
    const { enrollmentType } = payloadOf(ctx);
    if (!enrollmentType) return false;
    return enrollmentType === configuredEnrollmentType(configData);
  },

  async getRecipients(_ctx, configData): Promise<NotifierRecipient[]> {
    const userIds = configuredRecipientUserIds(configData);
    if (userIds.length === 0) return [];

    const { storage } = await import("../../../storage");
    // Only staff/admin users may be notified through this queue — guard against
    // a stale config still naming someone who lost access. Mirrors the option
    // set the staff-recipients widget offers ("staff" + "admin").
    const staffUsers = await storage.users.getUsersWithAnyPermission(["staff", "admin"]);
    const staffIds = new Set(staffUsers.map((u) => u.id));

    const byContact = new Map<string, NotifierRecipient>();
    for (const userId of userIds) {
      if (!staffIds.has(userId)) continue;
      const user = await storage.users.getUser(userId);
      if (!user?.email) continue;
      const contact = await storage.contacts.getContactByEmail(user.email);
      if (contact && !byContact.has(contact.id)) {
        byContact.set(contact.id, { contactId: contact.id, userId: user.id });
      }
    }
    return Array.from(byContact.values());
  },

  async getMessage(
    medium: NotificationMedium,
    _recipient: NotifierRecipient,
    ctx: EventNotifierEventContext,
  ): Promise<NotifierMessageContent | null> {
    const { electionId, enrollmentType, operation } = payloadOf(ctx);
    if (!enrollmentType) return null;
    const typeLabel = ENROLLMENT_TYPE_LABELS[enrollmentType];
    const verb = operationVerb(operation);

    // Resolve the worker's name for a friendlier message. Deleted elections are
    // already gone, so fall back to a generic phrasing.
    let workerName: string | null = null;
    if (operation !== "deleted") {
      const { storage } = await import("../../../storage");
      const view = await storage.workerTrustElections.getViewById(electionId);
      workerName = view?.workerName ?? null;
    }
    const subject = workerName
      ? `${typeLabel} ${verb} for ${workerName}`
      : `${typeLabel} ${verb}`;
    const body = workerName
      ? `A ${typeLabel.toLowerCase()} was ${verb} for ${workerName}.`
      : `A ${typeLabel.toLowerCase()} was ${verb}.`;
    const linkUrl = `/trust/enrollment-queue?type=${enrollmentType}`;
    const absoluteUrl = absoluteQueueUrl(enrollmentType);

    switch (medium) {
      case "inapp":
        return {
          title: subject,
          body,
          linkUrl,
          linkLabel: "Review Enrollment",
        };
      case "email":
        return {
          subject,
          bodyText: `${body}\n\nReview the enrollment queue: ${absoluteUrl}`,
        };
      case "sms":
        return {
          message: `${body} Review: ${absoluteUrl}`,
        };
      default:
        return null;
    }
  },
};

registerEventNotifier(trustElectionEnrollmentNotifier);
