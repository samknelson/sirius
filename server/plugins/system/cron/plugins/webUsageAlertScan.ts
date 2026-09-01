import { storage } from "../../../../storage";
import { getTodayYmd, type Ymd } from "@shared/utils/date";
import { eventBus, EventType } from "../../../../services/event-bus";
import { getEnabledConfigsForKind } from "../../../_core/plugin-config-cache";
import { webServiceRegistry } from "../../../web-service/registry";
import {
  parseWcUsageRules,
  parseWsClientUsageRules,
  parseWsPluginUsageRules,
  usageAlertSendKey,
  wcTargetKey,
  wsClientTargetKey,
  wsPluginTargetKey,
  WC_USAGE_ALERT_NOTIFIER_ID,
  WS_CLIENT_USAGE_ALERT_NOTIFIER_ID,
  WS_PLUGIN_USAGE_ALERT_NOTIFIER_ID,
  type WebUsageSurface,
} from "../../../../services/web-usage-alerts";
import { registerCronPlugin } from "../registry";
import type { CronJobContext, CronJobResult } from "../types";

/**
 * Finds the usage rules whose number has been reached today and raises one
 * event per crossing.
 *
 * Only today's counts are compared: a usage alert answers "how busy are we
 * right now", and a window that stretched further back would keep alerting
 * about traffic an operator has already dealt with.
 *
 * Re-running is harmless, and that is the point of the schedule. The scan
 * raises the same crossing again on every pass; what makes each one deliver
 * exactly once is the send-once key the notifiers build (configuration + day +
 * what was counted + the number watched for), checked before a recipient's
 * anti-flood budget is spent. So the job can run a few times a day — an alert
 * arrives during the day rather than at midnight — and an admin who lowers a
 * rule's number below today's count hears about it on the next pass instead of
 * waiting for tomorrow.
 */

/** What one crossing looks like before it is raised. */
interface Crossing {
  surface: WebUsageSurface;
  configId: string;
  subject: string;
  targetKey: string;
  count: number;
  threshold: number;
}

/**
 * Today's outgoing calls for one service, optionally narrowed to one request
 * type. The counter groups by (service, request type), so the narrowed and the
 * whole-service figure both come from the same read.
 */
async function wcCount(
  ymd: Ymd,
  service: string,
  requestType: string | undefined,
): Promise<number> {
  const rows = await storage.wcStats.countsByService({
    start: ymd,
    end: ymd,
    service,
    requestType,
  });
  return rows.reduce((sum, row) => sum + row.calls, 0);
}

/** Today's incoming calls matching the given filters. */
async function wsCount(
  ymd: Ymd,
  filters: { clientId?: string; pluginId?: string; operation?: string },
): Promise<number> {
  const report = await storage.wsStats.report({
    start: ymd,
    end: ymd,
    ...filters,
  });
  return report.total;
}

/** The calling client's name, so a message says who rather than a uuid. */
async function clientName(clientId: string): Promise<string> {
  const client = await storage.wsClients.get(clientId);
  return client?.name ?? clientId;
}

/** The service's name, from the registry rather than from counted rows. */
function pluginName(pluginId: string): string {
  return webServiceRegistry.get(pluginId)?.name ?? pluginId;
}

/** "Twilio / phone-lookup", or just "Twilio" for a whole-service rule. */
function narrowed(subject: string, part: string | undefined): string {
  return part ? `${subject} / ${part}` : subject;
}

registerCronPlugin({
  metadata: {
    id: "web-usage-alert-scan",
    name: "Web Service Usage Alert Scan",
    description:
      "Compares today's outgoing and incoming call counts against the configured usage alert rules and raises an alert for each rule that has been reached",
    singleton: true,
  },
  // A few times a day: often enough that a busy morning is reported while it
  // is still the morning, and re-running costs nothing.
  defaultSchedule: "20 */6 * * *",
  defaultEnabled: true,

  async execute(context: CronJobContext): Promise<CronJobResult> {
    const ymd = getTodayYmd();
    const envelopes = await getEnabledConfigsForKind("event-notifier");

    // Several configurations may watch the same dimension; each one gets its
    // own alert, but the counter only has to answer once per pass.
    const counts = new Map<string, number>();
    const countOnce = async (key: string, read: () => Promise<number>): Promise<number> => {
      const cached = counts.get(key);
      if (cached !== undefined) return cached;
      const value = await read();
      counts.set(key, value);
      return value;
    };

    const crossings: Crossing[] = [];
    let rulesChecked = 0;

    for (const envelope of envelopes) {
      const { id: configId, pluginId, data } = envelope.config;

      if (pluginId === WC_USAGE_ALERT_NOTIFIER_ID) {
        for (const rule of parseWcUsageRules(data)) {
          rulesChecked++;
          const targetKey = wcTargetKey(rule);
          const count = await countOnce(targetKey, () =>
            wcCount(ymd, rule.service, rule.requestType),
          );
          if (count < rule.threshold) continue;
          crossings.push({
            surface: "wc",
            configId,
            subject: narrowed(rule.service, rule.requestType),
            targetKey,
            count,
            threshold: rule.threshold,
          });
        }
        continue;
      }

      if (pluginId === WS_CLIENT_USAGE_ALERT_NOTIFIER_ID) {
        for (const rule of parseWsClientUsageRules(data)) {
          rulesChecked++;
          const targetKey = wsClientTargetKey(rule);
          const count = await countOnce(targetKey, () =>
            wsCount(ymd, { clientId: rule.clientId, operation: rule.operation }),
          );
          if (count < rule.threshold) continue;
          crossings.push({
            surface: "ws-client",
            configId,
            subject: narrowed(await clientName(rule.clientId), rule.operation),
            targetKey,
            count,
            threshold: rule.threshold,
          });
        }
        continue;
      }

      if (pluginId === WS_PLUGIN_USAGE_ALERT_NOTIFIER_ID) {
        for (const rule of parseWsPluginUsageRules(data)) {
          rulesChecked++;
          const targetKey = wsPluginTargetKey(rule);
          const count = await countOnce(targetKey, () =>
            wsCount(ymd, { pluginId: rule.pluginId, operation: rule.operation }),
          );
          if (count < rule.threshold) continue;
          crossings.push({
            surface: "ws-plugin",
            configId,
            subject: narrowed(pluginName(rule.pluginId), rule.operation),
            targetKey,
            count,
            threshold: rule.threshold,
          });
        }
      }
    }

    const described = crossings.map(
      (c) => `${c.subject}: ${c.count} today (threshold ${c.threshold})`,
    );

    if (context.mode === "test") {
      return {
        message: `Test mode: ${crossings.length} usage alert(s) would be raised from ${rulesChecked} rule(s)`,
        metadata: {
          ymd,
          rulesChecked,
          wouldRaise: crossings.length,
          // Named so an operator can see which crossings are already spent:
          // a key that has been sent stays sent for the rest of the day.
          crossings: crossings.map((c) => ({
            configId: c.configId,
            surface: c.surface,
            subject: c.subject,
            count: c.count,
            threshold: c.threshold,
            sendKey: usageAlertSendKey({
              configId: c.configId,
              ymd,
              targetKey: c.targetKey,
              threshold: c.threshold,
            }),
          })),
        },
      };
    }

    for (const crossing of crossings) {
      await eventBus.emit(EventType.WEB_USAGE_THRESHOLD_REACHED, {
        surface: crossing.surface,
        configId: crossing.configId,
        ymd,
        subject: crossing.subject,
        targetKey: crossing.targetKey,
        count: crossing.count,
        threshold: crossing.threshold,
      });
    }

    return {
      message: `Raised ${crossings.length} usage alert(s) from ${rulesChecked} rule(s)`,
      metadata: {
        ymd,
        rulesChecked,
        raised: crossings.length,
        ...(described.length ? { crossings: described } : {}),
      },
    };
  },
});
