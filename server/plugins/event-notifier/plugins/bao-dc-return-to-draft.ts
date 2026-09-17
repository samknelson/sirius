import {
  EventType,
  type BaoDcCaseSavedPayload,
} from "../../../services/event-bus";
import { registerEventNotifier } from "../registry";
import type {
  EventNotifierEventContext,
  EventNotifierPlugin,
} from "../types";

function payloadOf(ctx: EventNotifierEventContext): BaoDcCaseSavedPayload {
  return ctx.payload as BaoDcCaseSavedPayload;
}

/**
 * Tells the MSR who created a Disability Credit case that an approver returned
 * the submitted case for correction. Automatic readiness bounces intentionally
 * carry no explicitApproverReturn marker and never dispatch here.
 */
export const baoDcReturnToDraftNotifier: EventNotifierPlugin = {
  id: "bao_dc_return_to_draft",
  name: "Disability Credit Return to Draft",
  description:
    "Notifies the MSR who created a Disability Credit case when an approver returns it from the approval queue to draft.",
  order: 105,
  requiredComponent: "sitespecific.bao",
  singleton: true,
  staffNotification: true,
  notifySelf: true,
  subscribedEvents: [EventType.BAO_DC_CASE_SAVED],
  supportedMedia: ["inapp"],

  shouldDispatch(ctx): boolean {
    const payload = payloadOf(ctx);
    return (
      payload.dcEventType === "case_status_changed" &&
      payload.previousStatus === "in_queue" &&
      payload.status === "draft" &&
      payload.explicitApproverReturn === true &&
      typeof payload.reason === "string" &&
      payload.reason.trim().length > 0 &&
      typeof payload.createdByUserId === "string" &&
      payload.createdByUserId.length > 0
    );
  },

  resolveStaffRecipientUserIds(ctx): string[] {
    const creator = payloadOf(ctx).createdByUserId;
    return typeof creator === "string" && creator ? [creator] : [];
  },

  async getMessage(medium, _recipient, ctx) {
    if (medium !== "inapp") return null;
    const payload = payloadOf(ctx);
    const reason = payload.reason?.trim();
    if (!reason) return null;
    return {
      title: "Disability Credit case returned to draft",
      body: `An approver returned your Disability Credit case for correction. Feedback: ${reason}`,
      linkUrl: `/bao/dc/cases/${encodeURIComponent(payload.caseId)}`,
      linkLabel: "Review Case",
    };
  },
};

registerEventNotifier(baoDcReturnToDraftNotifier);