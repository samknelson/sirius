import { ChargePlugin } from "../base";
import {
  TriggerType,
  PluginContext,
  PluginExecutionResult,
  HoursSavedContext,
  LedgerTransaction,
} from "../types";
import { registerChargePlugin } from "../registry";
import type { ChargePluginMetadata } from "../types";
import { z } from "zod";
import { logger } from "../../../../logger";
import { storage } from "../../../../storage/database";
import { computeSlaForWorkerYear } from "../../../../services/sitespecific/gbhet/pension-sla";
import type { ChargePluginConfig } from "@shared/schema";

const PLUGIN_ID = "gbhet-pension-sla-hourly";

const settingsSchema = z.object({
  enabled: z.boolean().optional(),
});

class GbhetPensionSlaHourlyPlugin extends ChargePlugin {
  readonly metadata: ChargePluginMetadata = {
    id: PLUGIN_ID,
    name: "GBHE Pension SLA (Hourly Trigger)",
    description:
      "On worker hours changes for a tiered plan year, recomputes the worker's annual SLA tier value and writes/updates a Dec-31 ledger entry (idempotent on workerId+year).",
    triggers: [TriggerType.HOURS_SAVED],
    defaultScope: "global" as const,
    configSchema: {
      type: "object",
      properties: {},
    },
    requiredComponent: "sitespecific.gbhet.pension",
  };

  async execute(
    context: PluginContext,
    config: ChargePluginConfig,
  ): Promise<PluginExecutionResult> {
    if (context.trigger !== TriggerType.HOURS_SAVED) {
      return { success: false, transactions: [], error: `Wrong trigger type: ${context.trigger}` };
    }
    const ctx = context as HoursSavedContext;

    try {
      const planYears = await storage.gbhetPension.planYears.getAll();
      const planYear = planYears.find((py) => py.year === ctx.year);
      if (!planYear) {
        return { success: true, transactions: [], message: `No plan year configured for ${ctx.year}` };
      }
      if (planYear.accrualMethod !== "tiered") {
        return { success: true, transactions: [], message: `Plan year ${ctx.year} is not tiered` };
      }

      const result = await computeSlaForWorkerYear(
        ctx.workerId,
        ctx.year,
        planYear,
        config.id,
        config.account,
      );

      const transactions: LedgerTransaction[] = [];
      if (result.created || result.updated) {
        logger.debug("SLA hourly plugin updated entry", {
          service: PLUGIN_ID,
          workerId: ctx.workerId,
          year: ctx.year,
          amount: result.amount,
          changeType: result.created ? "create" : "update",
        });
      }

      return {
        success: true,
        transactions,
        message: result.skipped
          ? `Worker ${ctx.workerId} year ${ctx.year} SLA unchanged`
          : `Worker ${ctx.workerId} year ${ctx.year} SLA ${result.created ? "created" : "updated"}: $${result.amount}`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("Failed to compute SLA hourly", {
        service: PLUGIN_ID,
        workerId: ctx.workerId,
        year: ctx.year,
        error: message,
      });
      return { success: false, transactions: [], error: message };
    }
  }
}

const plugin = new GbhetPensionSlaHourlyPlugin();
registerChargePlugin(plugin);
export default plugin;
