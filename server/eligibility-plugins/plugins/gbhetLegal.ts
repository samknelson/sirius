import { EligibilityPlugin } from "../base";
import { 
  EligibilityContext, 
  EligibilityResult, 
  EligibilityPluginMetadata,
  baseEligibilityConfigSchema,
} from "../types";
import { registerEligibilityPlugin } from "../registry";
import { storage } from "../../storage/database";
import { z } from "zod";

const gbhetLegalConfigSchema = baseEligibilityConfigSchema.extend({
  monthsOffset: z.number().int().min(1).default(4),
});

type GbhetLegalConfig = z.infer<typeof gbhetLegalConfigSchema>;

class GbhetLegalPlugin extends EligibilityPlugin<GbhetLegalConfig> {
  readonly metadata: EligibilityPluginMetadata = {
    id: "gbhet-legal",
    name: "GBHET Legal",
    description: "Worker must have nonzero hours in the month that is a specified number of months prior (default: 4 months).",
    configSchema: gbhetLegalConfigSchema,
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

    const totalHours = await storage.workerHours.getWorkerMonthlyHoursAllEmployers(
      context.workerId,
      targetYear,
      targetMonth
    );

    if (totalHours > 0) {
      const monthName = new Date(targetYear, targetMonth - 1, 1).toLocaleString('default', { month: 'long' });
      return { 
        eligible: true,
        reason: `Worker had ${totalHours} hours in ${monthName} ${targetYear}`
      };
    }

    const monthName = new Date(targetYear, targetMonth - 1, 1).toLocaleString('default', { month: 'long' });
    return { 
      eligible: false, 
      reason: `Worker had no hours in ${monthName} ${targetYear} (${monthsOffset} months prior)` 
    };
  }
}

const plugin = new GbhetLegalPlugin();
registerEligibilityPlugin(plugin);

export { GbhetLegalPlugin };
