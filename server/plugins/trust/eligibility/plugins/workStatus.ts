import { EligibilityPlugin } from "../base";
import {
  EligibilityContext,
  EligibilityResult,
  EligibilityPluginMetadata,
  BaseEligibilityConfig,
} from "../types";
import { registerEligibilityPlugin } from "../registry";
import { storage } from "../../../../storage/database";
import { createUnifiedOptionsStorage } from "../../../../storage/unified-options";

const unifiedOptionsStorage = createUnifiedOptionsStorage();

interface WorkStatusConfig extends BaseEligibilityConfig {
  allowedStatusIds: string[];
}

class WorkStatusPlugin extends EligibilityPlugin<WorkStatusConfig> {
  readonly metadata: EligibilityPluginMetadata = {
    id: "work-status",
    name: "Work Status",
    description: "Worker must have one of the specified work statuses to be eligible.",
    configSchema: {
      type: "object",
      required: ["allowedStatusIds"],
      properties: {
        allowedStatusIds: {
          type: "array",
          title: "Allowed work statuses",
          description: "Workers must have one of these work statuses to be eligible.",
          minItems: 1,
          items: { type: "string", format: "uuid" },
          uniqueItems: true,
          default: [],
          "x-options-resource": "worker-ws",
        } as never,
      },
    },
  };

  async evaluate(
    context: EligibilityContext,
    config: WorkStatusConfig
  ): Promise<EligibilityResult> {
    const monthName = new Date(context.asOfYear, context.asOfMonth - 1, 1).toLocaleString(
      "default",
      { month: "long" },
    );

    const statusHistory = await storage.workerWsh.getWorkerWsh(context.workerId);

    const asOfDate = new Date(context.asOfYear, context.asOfMonth - 1, 1);
    asOfDate.setMonth(asOfDate.getMonth() + 1);
    asOfDate.setDate(0);
    const asOfDateStr = asOfDate.toISOString().split("T")[0];

    const effectiveEntry = statusHistory.find((entry) => entry.date <= asOfDateStr);

    if (!effectiveEntry) {
      return {
        eligible: false,
        reason: `Worker had no work status assigned as of ${monthName} ${context.asOfYear}`,
      };
    }

    const statusId = effectiveEntry.wsId;
    const statusName = effectiveEntry.ws?.name || "Unknown";
    const isAllowed = config.allowedStatusIds.includes(statusId);

    if (isAllowed) {
      return {
        eligible: true,
        reason: `Worker had status "${statusName}" as of ${monthName} ${context.asOfYear}`,
      };
    }

    const allowedStatuses = await Promise.all(
      config.allowedStatusIds.map((id) => unifiedOptionsStorage.get("worker-ws", id)),
    );
    const allowedNames = allowedStatuses
      .filter((s): s is NonNullable<typeof s> => s !== undefined && s !== null)
      .map((s) => s.name)
      .join(", ");

    return {
      eligible: false,
      reason: `Worker had status "${statusName}" as of ${monthName} ${context.asOfYear}, but allowed statuses are: ${allowedNames}`,
    };
  }
}

const plugin = new WorkStatusPlugin();
registerEligibilityPlugin(plugin);

export { WorkStatusPlugin };
