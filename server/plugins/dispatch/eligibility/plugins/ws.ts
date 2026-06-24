import { registerDispatchEligPlugin } from "../registry";
import { logger } from "../../../../logger";
import type { DispatchEligPlugin, EligibilityCondition, EligibilityQueryContext } from "../registry";

const WS_CATEGORY = "ws";

interface WsPluginConfig {
  eligibleWorkStatuses?: string[];
}

/**
 * `dispatch_ws` — READ side. Filters workers by the eligible work statuses
 * configured per job type. The `ws` fact (the worker's current work status) is
 * maintained by the `dispatch_ws` denorm plugin.
 */
export const dispatchWsPlugin: DispatchEligPlugin = {
  id: "dispatch_ws",
  name: "Work Status",
  description: "Filters workers based on eligible work statuses configured per job type",
  requiredComponent: "dispatch",

  configSchema: {
    type: "object",
    properties: {
      eligibleWorkStatuses: {
        type: "array",
        title: "Eligible Work Statuses",
        description:
          "Work statuses eligible for jobs of this type (leave empty for all).",
        items: { type: "string", format: "uuid" },
        uniqueItems: true,
        default: [],
        "x-options-resource": "worker-ws",
      },
    },
  },

  async getEligibilityCondition(_context: EligibilityQueryContext, config: Record<string, unknown>): Promise<EligibilityCondition | null> {
    const pluginConfig = config as WsPluginConfig;
    const eligibleWorkStatuses = pluginConfig?.eligibleWorkStatuses || [];

    if (eligibleWorkStatuses.length === 0) {
      logger.debug(`No eligible work statuses configured, all workers eligible`, {
        service: "dispatch-elig-ws",
        jobId: _context.jobId,
      });
      return null;
    }

    logger.debug(`Plugin requires specific work statuses for eligibility`, {
      service: "dispatch-elig-ws",
      jobId: _context.jobId,
      eligibleWorkStatusCount: eligibleWorkStatuses.length,
    });

    return {
      category: WS_CATEGORY,
      type: "exists",
      value: eligibleWorkStatuses.join(","),
      values: eligibleWorkStatuses,
    };
  },
};

registerDispatchEligPlugin(dispatchWsPlugin);
