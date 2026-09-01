import { storage } from "../../storage";
import type { Ymd } from "@shared/utils/date";
import { webServiceRegistry } from "../web-service/registry";
import {
  parseWcUsageRules,
  parseWsClientUsageRules,
  parseWsPluginUsageRules,
  wcTargetKey,
  wsClientTargetKey,
  wsPluginTargetKey,
} from "../../services/web-usage-alerts";

/**
 * Reading the counters, for one usage alert configuration.
 *
 * This is the whole of "has anything been reached today", and it lives with the
 * notifiers rather than with whatever wakes them: a tick says only that ten
 * minutes have passed, so the plugin holding the rules is the only thing that
 * knows what to count, what number to compare it against, and what to call the
 * result in a message.
 *
 * Only TODAY is compared. A usage alert answers "how busy are we right now",
 * and a window stretching further back would keep reporting traffic an operator
 * has already dealt with.
 *
 * Each surface's evaluation reads its own configuration's rules and nothing
 * else — no other configuration's, and no other surface's.
 */

/** One rule of one configuration whose number has been reached today. */
export interface UsageCrossing {
  /** What was counted, in words: "Twilio / phone-lookup". */
  subject: string;
  /** What was counted, as a stable key; part of the send-once key. */
  targetKey: string;
  /** Today's count for that dimension, as read just now. */
  count: number;
  /** The number the rule was watching for. */
  threshold: number;
}

/** How one surface answers "what is over its number today". */
export type FindUsageCrossings = (
  configData: unknown,
  ymd: Ymd,
) => Promise<UsageCrossing[]>;

/**
 * Read each dimension at most once per evaluation. One configuration may hold
 * two rules watching the same dimension at different numbers (a warning and an
 * alarm), and both are answered by the same count.
 */
function counterCache(): (key: string, read: () => Promise<number>) => Promise<number> {
  const counts = new Map<string, number>();
  return async (key, read) => {
    const cached = counts.get(key);
    if (cached !== undefined) return cached;
    const value = await read();
    counts.set(key, value);
    return value;
  };
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
  const report = await storage.wsStats.report({ start: ymd, end: ymd, ...filters });
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

/** Outgoing calls to a third-party service. */
export const findWcCrossings: FindUsageCrossings = async (configData, ymd) => {
  const countOnce = counterCache();
  const crossings: UsageCrossing[] = [];
  for (const rule of parseWcUsageRules(configData)) {
    const targetKey = wcTargetKey(rule);
    const count = await countOnce(targetKey, () =>
      wcCount(ymd, rule.service, rule.requestType),
    );
    if (count < rule.threshold) continue;
    crossings.push({
      subject: narrowed(rule.service, rule.requestType),
      targetKey,
      count,
      threshold: rule.threshold,
    });
  }
  return crossings;
};

/** Incoming calls, counted per calling client. */
export const findWsClientCrossings: FindUsageCrossings = async (configData, ymd) => {
  const countOnce = counterCache();
  const crossings: UsageCrossing[] = [];
  for (const rule of parseWsClientUsageRules(configData)) {
    const targetKey = wsClientTargetKey(rule);
    const count = await countOnce(targetKey, () =>
      wsCount(ymd, { clientId: rule.clientId, operation: rule.operation }),
    );
    if (count < rule.threshold) continue;
    crossings.push({
      subject: narrowed(await clientName(rule.clientId), rule.operation),
      targetKey,
      count,
      threshold: rule.threshold,
    });
  }
  return crossings;
};

/** Incoming calls, counted per web service of ours. */
export const findWsPluginCrossings: FindUsageCrossings = async (configData, ymd) => {
  const countOnce = counterCache();
  const crossings: UsageCrossing[] = [];
  for (const rule of parseWsPluginUsageRules(configData)) {
    const targetKey = wsPluginTargetKey(rule);
    const count = await countOnce(targetKey, () =>
      wsCount(ymd, { pluginId: rule.pluginId, operation: rule.operation }),
    );
    if (count < rule.threshold) continue;
    crossings.push({
      subject: narrowed(pluginName(rule.pluginId), rule.operation),
      targetKey,
      count,
      threshold: rule.threshold,
    });
  }
  return crossings;
};
