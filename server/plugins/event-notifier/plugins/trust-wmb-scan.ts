import {
  EventType,
  type TrustWmbScanCompletedPayload,
} from "../../../services/event-bus";
import { registerEventNotifier } from "../registry";
import {
  type EventNotifierEventContext,
  type EventNotifierPlugin,
  type NotificationMedium,
  type NotifierMessageContent,
} from "../types";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function payloadOf(ctx: EventNotifierEventContext): TrustWmbScanCompletedPayload {
  return ctx.payload as TrustWmbScanCompletedPayload;
}

function periodLabel(p: TrustWmbScanCompletedPayload): string {
  const monthName = MONTH_NAMES[p.month - 1] || `Month ${p.month}`;
  return `${monthName} ${p.year}`;
}

/**
 * Notifies internal staff when a monthly Worker Monthly Benefits (WMB) scan
 * finishes. This is a staff-mode notifier: the admin picks the recipient
 * staff/admin users per config and the framework resolves their contacts and
 * fans the message out over the selected media. Replaces the bespoke
 * staff-alert framework that keyed recipients off a `staff_alert:*` variable.
 */
export const trustWmbScanNotifier: EventNotifierPlugin = {
  id: "trust-wmb-scan",
  name: "WMB Scan Completion Notifier",
  description:
    "Notifies selected staff when a monthly Worker Monthly Benefits scan completes.",
  order: 100,
  requiredComponent: "trust.benefits.scan",
  staffNotification: true,
  subscribedEvents: [EventType.TRUST_WMB_SCAN_COMPLETED],
  supportedMedia: ["email", "sms", "inapp"],
  configSchema: {
    type: "object",
    properties: {
      staffRecipientUserIds: {
        type: "array",
        title: "Recipients",
        description:
          "Staff or admin users who receive a notification when a scan completes.",
        items: { type: "string" },
        "x-widget": "staff-recipients",
      },
    },
  },

  async getMessage(
    medium: NotificationMedium,
    _recipient,
    ctx: EventNotifierEventContext,
  ): Promise<NotifierMessageContent | null> {
    const p = payloadOf(ctx);
    const label = periodLabel(p);
    const {
      totalProcessed,
      successCount,
      failedCount,
      benefitsStarted,
      benefitsContinued,
      benefitsTerminated,
    } = p;

    switch (medium) {
      case "sms":
        return {
          message:
            `WMB Scan for ${label} completed. ${totalProcessed} workers processed ` +
            `(${successCount} success, ${failedCount} failed). Benefits: ` +
            `${benefitsStarted} started, ${benefitsContinued} continued, ${benefitsTerminated} terminated.`,
        };
      case "email":
        return {
          subject: `WMB Scan Completed: ${label}`,
          bodyText:
            `The Worker Monthly Benefits scan for ${label} has completed.\n\n` +
            `Summary:\n- Total workers processed: ${totalProcessed}\n` +
            `- Successful: ${successCount}\n- Failed: ${failedCount}\n\n` +
            `Benefit Changes:\n- Benefits Started: ${benefitsStarted}\n` +
            `- Benefits Continued: ${benefitsContinued}\n- Benefits Terminated: ${benefitsTerminated}\n\n` +
            `You can view the full report in the WMB Scan Queue page.`,
          bodyHtml:
            `<h2>WMB Scan Completed: ${label}</h2>` +
            `<p>The Worker Monthly Benefits scan for ${label} has completed.</p>` +
            `<h3>Summary</h3><ul>` +
            `<li><strong>Total workers processed:</strong> ${totalProcessed}</li>` +
            `<li><strong>Successful:</strong> ${successCount}</li>` +
            `<li><strong>Failed:</strong> ${failedCount}</li></ul>` +
            `<h3>Benefit Changes</h3><ul>` +
            `<li><strong>Benefits Started:</strong> ${benefitsStarted}</li>` +
            `<li><strong>Benefits Continued:</strong> ${benefitsContinued}</li>` +
            `<li><strong>Benefits Terminated:</strong> ${benefitsTerminated}</li></ul>` +
            `<p>You can view the full report in the WMB Scan Queue page.</p>`,
        };
      case "inapp":
        return {
          title: `WMB Scan Completed: ${label}`,
          body:
            `Processed ${totalProcessed} workers (${successCount} success, ${failedCount} failed). ` +
            `Benefits: ${benefitsStarted} started, ${benefitsContinued} continued, ${benefitsTerminated} terminated.`,
          linkUrl: `/admin/wmb-scan/${p.statusId}`,
          linkLabel: "View Scan Details",
        };
      default:
        return null;
    }
  },
};

registerEventNotifier(trustWmbScanNotifier);
