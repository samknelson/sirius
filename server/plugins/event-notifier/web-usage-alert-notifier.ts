import { escapeHtml } from "@shared/utils/html/escape";
import type { JsonSchema, UiSchema } from "@shared/json-schema-form";
import { getTodayYmd, type Ymd } from "@shared/utils/date";
import { EventType } from "../../services/event-bus";
import { absoluteUrl } from "../../lib/base-url";
import { logger, storageLogger } from "../../logger";
import { usageAlertMessageSendKey } from "../../services/web-usage-alerts";
import type { FindUsageCrossings, UsageCrossing } from "./usage-alert-crossings";
import type {
  EventNotifierEventContext,
  EventNotifierPlugin,
  NotificationMedium,
  NotifierMessageContent,
} from "./types";

/**
 * The one shape all three usage alert notifiers have.
 *
 * They differ only in what they count, how a message names it, and which stats
 * page it points at. Everything else — being a staff notifier, waking on the
 * ten minute tick, composing per channel, and building the send-once key — is
 * the same job three times, so it is written once.
 *
 * These notifiers are woken by a heartbeat rather than by something happening,
 * which makes each one responsible for its own question: the tick says only
 * that ten minutes have passed, and the plugin decides whether anything is
 * worth saying. Nothing outside the plugin knows what a threshold is.
 */
export interface UsageAlertNotifierSpec {
  id: string;
  name: string;
  description: string;
  /** Recipients + rules; see `usageAlertConfigSchema`. */
  configSchema: JsonSchema;
  /** Which rule fields are pickers; see `usageAlertUiSchema`. */
  uiSchema: UiSchema;
  /** The existing stats page whose numbers these alerts come from. */
  statsPath: string;
  /** This surface's own counting; see `usage-alert-crossings.ts`. */
  findCrossings: FindUsageCrossings;
  /**
   * How a message names what was counted, given the crossing's subject —
   * e.g. `"Outgoing calls to Twilio / phone-lookup"`.
   */
  phrase: (subject: string) => string;
}

/** What one configuration's evaluation found, for the message that follows. */
interface Evaluated {
  ymd: Ymd;
  crossings: UsageCrossing[];
}

export function createUsageAlertNotifier(
  spec: UsageAlertNotifierSpec,
): EventNotifierPlugin {
  /**
   * `shouldDispatch` answers a boolean, but it is also the only place the
   * counters are read — so what it found has to reach `getMessage` somehow.
   * The dispatcher builds a fresh `ctx` per configuration dispatched for, which
   * makes it the natural key, and a WeakMap keeps nothing alive afterwards.
   */
  const evaluatedByCtx = new WeakMap<EventNotifierEventContext, Evaluated>();

  return {
    id: spec.id,
    name: spec.name,
    description: spec.description,
    order: 100,
    // Gated exactly like the usage dashboard card this mirrors: admin-only,
    // no component of its own.
    requiredPolicy: "admin",
    staffNotification: true,
    // The tick emitter can be run by hand from the cron admin screen. Without
    // this the operator who ran it would be dropped from their own alert.
    notifySelf: true,
    // Ten minutes is the finest heartbeat there is, and a usage alert wants to
    // be prompt. Repeats cost nothing: an unchanged crossing composes the same
    // message with the same send-once key, and the comm layer refuses it.
    subscribedEvents: [EventType.CRON_TICK_10M],
    supportedMedia: ["email", "sms", "inapp"],
    configSchema: spec.configSchema,
    uiSchema: spec.uiSchema,

    /**
     * Read this configuration's own counters and decide whether it has
     * anything to say. Every enabled configuration of this notifier is asked
     * separately, with its own rules, on every tick.
     */
    async shouldDispatch(
      ctx: EventNotifierEventContext,
      configData: unknown,
    ): Promise<boolean> {
      if (!ctx.configId) return false;
      const ymd = getTodayYmd();
      const crossings = await spec.findCrossings(configData, ymd);
      if (crossings.length === 0) return false;
      evaluatedByCtx.set(ctx, { ymd, crossings });
      logger.debug(
        `Usage alert ${spec.id}: ${crossings.length} threshold(s) reached for config ${ctx.configId}`,
      );
      return true;
    },

    async getMessage(
      medium: NotificationMedium,
      _recipient,
      ctx: EventNotifierEventContext,
    ): Promise<NotifierMessageContent | null> {
      const found = evaluatedByCtx.get(ctx);
      if (!found) {
        // Only reachable if something composed a message without asking
        // shouldDispatch first; composing from a second, independent read
        // would report numbers nobody decided to send.
        logger.warn(
          `Usage alert ${spec.id}: asked for a message with no evaluation on the context`,
        );
        return null;
      }
      const { ymd, crossings } = found;
      const [first] = crossings;
      const single = crossings.length === 1;

      const line = (crossing: UsageCrossing) =>
        `${spec.phrase(crossing.subject)}: ${crossing.count} (threshold ${crossing.threshold})`;
      const headline = single
        ? `${spec.phrase(first.subject)} reached ${first.count} today (${ymd}), at or above the alert threshold of ${first.threshold}.`
        : `${crossings.length} usage alert thresholds have been reached today (${ymd}).`;
      const bodyText = single
        ? headline
        : `${headline}\n\n${crossings.map((c) => `- ${line(c)}`).join("\n")}`;
      const bodyHtml = single
        ? `<p>${escapeHtml(headline)}</p>`
        : `<p>${escapeHtml(headline)}</p><ul>${crossings
            .map((c) => `<li>${escapeHtml(line(c))}</li>`)
            .join("")}</ul>`;
      const summary = single
        ? `${first.subject} - ${first.count} today`
        : `${crossings.length} thresholds reached today`;

      // Delivered once per recipient per channel for exactly the set of
      // crossings this message reports.
      const sendKey = usageAlertMessageSendKey({
        configId: ctx.configId!,
        ymd,
        crossings,
      });

      switch (medium) {
        case "email":
          return {
            subject: `Usage alert - ${summary}`,
            bodyText: `${bodyText}\n\nFull figures: ${absoluteUrl(spec.statsPath)}\n`,
            bodyHtml:
              bodyHtml +
              `<p><a href="${escapeHtml(absoluteUrl(spec.statsPath))}">View the full figures</a></p>`,
            sendKey,
          };
        case "sms":
          return {
            message: `${bodyText} ${absoluteUrl(spec.statsPath)}`,
            sendKey,
          };
        case "inapp":
          return {
            title: single
              ? `Usage alert: ${first.subject}`
              : `Usage alert: ${crossings.length} thresholds reached`,
            body: bodyText,
            // In-app navigates inside the app, so the link stays relative.
            linkUrl: spec.statsPath,
            linkLabel: "View usage stats",
            sendKey,
          };
        default:
          return null;
      }
    },

    /**
     * A crossing used to be traceable through the scan cron's run history.
     * Nothing records it now — a tick's run row says only that a tick was
     * emitted — so the notifier writes its own entry, and writes it here
     * rather than at evaluation time: this fires once a message was actually
     * accepted for sending, so a threshold that is still over its number ten
     * minutes later does not restate itself in the log every tick.
     *
     * `logger` is console-only; `storageLogger` is what reaches the admin log
     * viewer, which is where an operator goes looking.
     */
    async onCommCreated(
      medium: NotificationMedium,
      _recipient,
      comm,
      ctx: EventNotifierEventContext,
    ): Promise<void> {
      const found = evaluatedByCtx.get(ctx);
      if (!found) return;
      const what = found.crossings
        .map((c) => `${c.subject} = ${c.count} (threshold ${c.threshold})`)
        .join("; ");
      storageLogger.info(`Usage alert sent: ${what}`, {
        module: "usage-alert",
        operation: "send",
        entity_id: comm.id,
        host_entity_id: comm.id,
        description: `Usage alert "${ctx.configName ?? spec.name}" sent by ${medium}: ${what}`,
        meta: {
          medium,
          notifierId: spec.id,
          configId: ctx.configId,
          ymd: found.ymd,
          crossings: found.crossings,
        },
      });
    },
  };
}
