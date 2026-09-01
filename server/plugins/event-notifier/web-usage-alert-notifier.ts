import { escapeHtml } from "@shared/utils/html/escape";
import type { JsonSchema, UiSchema } from "@shared/json-schema-form";
import {
  EventType,
  type WebUsageThresholdReachedPayload,
} from "../../services/event-bus";
import { absoluteUrl } from "../../lib/base-url";
import {
  usageAlertSendKey,
  type WebUsageSurface,
} from "../../services/web-usage-alerts";
import type {
  EventNotifierEventContext,
  EventNotifierPlugin,
  NotificationMedium,
  NotifierMessageContent,
} from "./types";

/**
 * The one shape all three usage alert notifiers have.
 *
 * They differ only in which surface's crossings are theirs, how a message
 * names what was counted, and which stats page it points at. Everything else —
 * being a staff notifier, filtering the event down to its own configuration,
 * composing per channel, and building the send-once key — is the same job
 * three times, so it is written once.
 */
export interface UsageAlertNotifierSpec {
  id: string;
  name: string;
  description: string;
  /** Which crossings belong to this notifier. */
  surface: WebUsageSurface;
  /** Recipients + rules; see `usageAlertConfigSchema`. */
  configSchema: JsonSchema;
  /** Which rule fields are pickers; see `usageAlertUiSchema`. */
  uiSchema: UiSchema;
  /** The existing stats page whose numbers these alerts come from. */
  statsPath: string;
  /**
   * How a message names what was counted, given the crossing's subject —
   * e.g. `"Outgoing calls to Twilio / phone-lookup"`.
   */
  phrase: (subject: string) => string;
}

function payloadOf(ctx: EventNotifierEventContext): WebUsageThresholdReachedPayload {
  return ctx.payload as WebUsageThresholdReachedPayload;
}

export function createUsageAlertNotifier(
  spec: UsageAlertNotifierSpec,
): EventNotifierPlugin {
  return {
    id: spec.id,
    name: spec.name,
    description: spec.description,
    order: 100,
    // Gated exactly like the usage dashboard card this mirrors: admin-only,
    // no component of its own.
    requiredPolicy: "admin",
    staffNotification: true,
    // The scan can be run by hand from the cron admin screen. Without this the
    // operator who ran it would be dropped from their own alert.
    notifySelf: true,
    subscribedEvents: [EventType.WEB_USAGE_THRESHOLD_REACHED],
    supportedMedia: ["email", "sms", "inapp"],
    configSchema: spec.configSchema,
    uiSchema: spec.uiSchema,

    /**
     * A crossing belongs to exactly ONE configuration — the one whose rule
     * produced it. Every other configuration of this notifier, and every
     * configuration of the other two, must let it pass.
     */
    async shouldDispatch(ctx: EventNotifierEventContext): Promise<boolean> {
      const p = payloadOf(ctx);
      if (!ctx.configId) return false;
      return p.surface === spec.surface && p.configId === ctx.configId;
    },

    async getMessage(
      medium: NotificationMedium,
      _recipient,
      ctx: EventNotifierEventContext,
    ): Promise<NotifierMessageContent | null> {
      const p = payloadOf(ctx);
      const what = spec.phrase(p.subject);
      const reached = `${what} reached ${p.count} today (${p.ymd}), at or above the alert threshold of ${p.threshold}.`;
      // One crossing, delivered once per recipient per channel: the
      // configuration, the day, what was counted and the number watched for.
      const sendKey = usageAlertSendKey({
        configId: p.configId,
        ymd: p.ymd,
        targetKey: p.targetKey,
        threshold: p.threshold,
      });

      switch (medium) {
        case "email":
          return {
            subject: `Usage alert - ${p.subject} - ${p.count} today`,
            bodyText:
              `${reached}\n\n` +
              `Full figures: ${absoluteUrl(spec.statsPath)}\n`,
            bodyHtml:
              `<p>${escapeHtml(reached)}</p>` +
              `<p><a href="${escapeHtml(absoluteUrl(spec.statsPath))}">View the full figures</a></p>`,
            sendKey,
          };
        case "sms":
          return {
            message: `${reached} ${absoluteUrl(spec.statsPath)}`,
            sendKey,
          };
        case "inapp":
          return {
            title: `Usage alert: ${p.subject}`,
            body: reached,
            // In-app navigates inside the app, so the link stays relative.
            linkUrl: spec.statsPath,
            linkLabel: "View usage stats",
            sendKey,
          };
        default:
          return null;
      }
    },
  };
}
