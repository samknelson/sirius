import { EligibilityPlugin } from "../base";
import {
  EligibilityContext,
  EligibilityResult,
  EligibilityPluginMetadata,
  BaseEligibilityConfig,
} from "../types";
import { registerEligibilityPlugin } from "../registry";
import { storage } from "../../../../storage/database";
import { workerHours } from "@shared/schema";
import { and, eq, sql } from "drizzle-orm";

interface GbhetLegalConfig extends BaseEligibilityConfig {
  monthsOffset: number;
}

class GbhetLegalPlugin extends EligibilityPlugin<GbhetLegalConfig> {
  readonly metadata: EligibilityPluginMetadata = {
    id: "gbhet-legal",
    name: "GBHET Legal",
    description:
      "Worker must have nonzero hours in the month that is a specified number of months prior (default: 4 months).",
    requiredComponent: "sitespecific.gbhet.legal",
    needsReadOnlyDb: true,
    configSchema: {
      type: "object",
      required: ["monthsOffset"],
      properties: {
        monthsOffset: {
          type: "integer",
          title: "Months offset",
          description:
            "How many months prior to the scan month to check for nonzero hours.",
          minimum: 1,
          default: 4,
        },
      },
    },
  };

  async evaluate(
    context: EligibilityContext,
    config: GbhetLegalConfig
  ): Promise<EligibilityResult> {
    const monthsOffset = config.monthsOffset ?? 4;

    let targetYear = context.asOfYear;
    let targetMonth = context.asOfMonth - monthsOffset;

    while (targetMonth <= 0) {
      targetMonth += 12;
      targetYear -= 1;
    }

    const totalHours = await storage.readOnly.query(async (client) => {
      const [result] = await client
        .select({ totalHours: sql<number>`COALESCE(SUM(${workerHours.hours}), 0)` })
        .from(workerHours)
        .where(
          and(
            eq(workerHours.workerId, context.subscriberWorker.id),
            eq(workerHours.year, targetYear),
            eq(workerHours.month, targetMonth),
          ),
        );
      return Number(result?.totalHours || 0);
    });

    const monthName = new Date(targetYear, targetMonth - 1, 1).toLocaleString("default", {
      month: "long",
    });

    if (totalHours > 0) {
      return {
        eligible: true,
        reason: `Worker had ${totalHours} hours in ${monthName} ${targetYear}`,
      };
    }

    return {
      eligible: false,
      reason: `Worker had no hours in ${monthName} ${targetYear} (${monthsOffset} months prior)`,
    };
  }
}

const plugin = new GbhetLegalPlugin();
registerEligibilityPlugin(plugin);

export { GbhetLegalPlugin };
